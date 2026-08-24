const { sql, getPool } = require('../config/db');

const SELECT_NUMERO_COM_ESTADO = `
  SELECT
    n.id,
    n.apelido,
    n.numero,
    n.status_conexao,
    n.nome_colaboradora,
    n.ativo,
    n.criado_em,
    e.id AS estado_id,
    e.nome AS estado_nome,
    e.uf AS estado_uf
  FROM NumerosRemetentes n
  JOIN Estados e ON e.id = n.estado_id
`;

function mapNumeroRow(row) {
  const {
    estado_id: estadoId,
    estado_nome: estadoNome,
    estado_uf: estadoUf,
    status_conexao: statusConexao,
    nome_colaboradora: nomeColaboradora,
    ...resto
  } = row;
  return {
    ...resto,
    statusConexao,
    nomeColaboradora: nomeColaboradora ?? null,
    estado: { id: estadoId, nome: estadoNome, uf: estadoUf },
  };
}

async function listNumeros() {
  const pool = await getPool();
  const result = await pool.request().query(`
    ${SELECT_NUMERO_COM_ESTADO}
    ORDER BY n.apelido
  `);
  return result.recordset.map(mapNumeroRow);
}

/**
 * Lista números remetentes filtrados por `status_conexao` (ex.: 'conectado').
 * Usado pela rotina de reconciliação no boot (`baileysSession.service.js:
 * reconciliarSessoesNoBoot`) para achar sessões que precisam ser
 * restauradas/rebaixadas após um restart do processo.
 */
async function listNumerosPorStatusConexao(statusConexao) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('statusConexao', sql.VarChar(30), statusConexao)
    .query(`
      ${SELECT_NUMERO_COM_ESTADO}
      WHERE n.status_conexao = @statusConexao
      ORDER BY n.apelido
    `);
  return result.recordset.map(mapNumeroRow);
}

async function existeEstado(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Estados WHERE id = @id');
  return result.recordset.length > 0;
}

async function findNumeroById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      ${SELECT_NUMERO_COM_ESTADO}
      WHERE n.id = @id
    `);
  const row = result.recordset[0];
  return row ? mapNumeroRow(row) : undefined;
}

async function insertNumero({ estadoId, apelido }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('estadoId', sql.Int, estadoId)
    .input('apelido', sql.NVarChar, apelido)
    .query(`
      INSERT INTO NumerosRemetentes (estado_id, apelido, numero, status_conexao, ativo, criado_em)
      OUTPUT inserted.id
      VALUES (@estadoId, @apelido, NULL, 'aguardando_conexao', 1, SYSUTCDATETIME())
    `);

  return findNumeroById(result.recordset[0].id);
}

/**
 * Atualiza os campos editáveis via PUT (`apelido`/`estadoId`/`ativo`/
 * `nomeColaboradora`). `apelido`/`estadoId`/`ativo` seguem a semântica antiga
 * de "não enviado = não mudar" (via COALESCE). `nomeColaboradora` precisa de
 * uma semântica diferente — precisa poder ser explicitamente limpo para
 * `NULL` (remover o nome da colaboradora) — então segue o mesmo padrão de
 * `updateConexao`: só entra no SET se `!== undefined`, e o valor (inclusive
 * `null`) é gravado exatamente como recebido.
 */
async function updateNumero(id, { apelido, estadoId, ativo, nomeColaboradora }) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('id', sql.Int, id)
    .input('apelido', sql.NVarChar, apelido ?? null)
    .input('estadoId', sql.Int, estadoId ?? null)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null);

  const sets = ['apelido = COALESCE(@apelido, apelido)', 'estado_id = COALESCE(@estadoId, estado_id)', 'ativo = COALESCE(@ativo, ativo)'];

  if (nomeColaboradora !== undefined) {
    request.input('nomeColaboradora', sql.NVarChar, nomeColaboradora);
    sets.push('nome_colaboradora = @nomeColaboradora');
  }

  await request.query(`
    UPDATE NumerosRemetentes
    SET ${sets.join(', ')}
    WHERE id = @id
  `);
}

/**
 * Atualiza os campos de conexão Baileys (`numero`/`status_conexao`) de um
 * número remetente. Diferente de `updateNumero` (que usa COALESCE porque
 * "não enviado" deve significar "não mudar"), aqui cada campo enviado é
 * gravado exatamente como recebido — inclusive `numero: null` explícito,
 * que precisa *limpar* a coluna (cenário de desconexão), algo que COALESCE
 * não consegue expressar. Um campo com valor `undefined` não entra no SET
 * (não é tocado); passe `null` explicitamente para limpar `numero`.
 */
async function updateConexao(id, { numero, statusConexao } = {}) {
  const pool = await getPool();
  const request = pool.request().input('id', sql.Int, id);

  const sets = [];
  if (numero !== undefined) {
    request.input('numero', sql.VarChar(20), numero);
    sets.push('numero = @numero');
  }
  if (statusConexao !== undefined) {
    request.input('statusConexao', sql.VarChar(30), statusConexao);
    sets.push('status_conexao = @statusConexao');
  }

  if (sets.length === 0) {
    return;
  }

  await request.query(`
    UPDATE NumerosRemetentes
    SET ${sets.join(', ')}
    WHERE id = @id
  `);
}

/**
 * Busca só `nome_colaboradora` de um número remetente — usada pelo worker de
 * envio (`workers/envioDisparos.worker.js`) para checar a pré-condição
 * "número tem colaboradora configurada" antes de tentar montar/enviar uma
 * mensagem (ver CONTRATO-CONTROLE-LIGACOES-API.md, seção "Envio de Disparos
 * (v6)"). `SELECT_NUMERO_COM_ESTADO`/`mapNumeroRow` também expõem
 * `nome_colaboradora` hoje (como `nomeColaboradora`, via `/numeros-remetentes`)
 * — esta função continua existindo como uma leitura mínima e isolada, sem o
 * JOIN em `Estados`, conveniente para o worker que só precisa desse único
 * campo. Retorna `null` se o número não existir.
 */
async function findNomeColaboradoraById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT nome_colaboradora FROM NumerosRemetentes WHERE id = @id');
  const row = result.recordset[0];
  return row ? (row.nome_colaboradora ?? null) : null;
}

/**
 * Exclui um número remetente se não houver Contatos nem LoteImportacaoEscolhas
 * vinculados a ele. Retorna 'not_found' | 'has_vinculos' | 'deleted'.
 */
async function deleteNumeroIfNoVinculos(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const numeroRequest = new sql.Request(transaction);
    numeroRequest.input('id', sql.Int, id);
    const numeroResult = await numeroRequest.query('SELECT id FROM NumerosRemetentes WHERE id = @id');

    if (!numeroResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const contatosRequest = new sql.Request(transaction);
    contatosRequest.input('id', sql.Int, id);
    const contatosResult = await contatosRequest.query(
      'SELECT COUNT(*) AS total FROM Contatos WHERE numero_remetente_id = @id'
    );

    if (contatosResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_vinculos';
    }

    const escolhasRequest = new sql.Request(transaction);
    escolhasRequest.input('id', sql.Int, id);
    const escolhasResult = await escolhasRequest.query(
      'SELECT COUNT(*) AS total FROM LoteImportacaoEscolhas WHERE numero_remetente_id = @id'
    );

    if (escolhasResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_vinculos';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM NumerosRemetentes WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listNumeros,
  listNumerosPorStatusConexao,
  existeEstado,
  findNumeroById,
  insertNumero,
  updateNumero,
  updateConexao,
  findNomeColaboradoraById,
  deleteNumeroIfNoVinculos,
};
