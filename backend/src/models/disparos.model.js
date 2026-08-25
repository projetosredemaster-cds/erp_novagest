const { sql, getPool } = require('../config/db');
const mensagensTemplatesModel = require('./mensagensTemplates.model');

const ORDENACOES = {
  nome_asc: 'c.nome ASC',
  nome_desc: 'c.nome DESC',
  recentes: 'c.criado_em DESC',
};

const SQL_DISPARADO_ULTIMOS_3_DIAS = `CASE WHEN EXISTS (
        SELECT 1
        FROM DisparoContatos dc
        JOIN Disparos d ON d.id = dc.disparo_id
        WHERE dc.contato_id = c.id
          AND d.criado_em >= DATEADD(day, -3, SYSUTCDATETIME())
      ) THEN 1 ELSE 0 END`;

async function listPainelDisparo() {
  const pool = await getPool();

  const estadosResult = await pool
    .request()
    .query('SELECT id, nome, uf FROM Estados ORDER BY nome');

  const numerosResult = await pool.request().query(`
    SELECT id, estado_id, apelido, status_conexao
    FROM NumerosRemetentes
    WHERE ativo = 1
    ORDER BY apelido
  `);

  const contatosResult = await pool.request().query(`
    SELECT estado_id, COUNT(*) AS total
    FROM Contatos
    WHERE estado_id IS NOT NULL
    GROUP BY estado_id
  `);

  const numerosPorEstado = new Map();
  for (const row of numerosResult.recordset) {
    if (!numerosPorEstado.has(row.estado_id)) {
      numerosPorEstado.set(row.estado_id, []);
    }
    numerosPorEstado.get(row.estado_id).push({
      id: row.id,
      apelido: row.apelido,
      statusConexao: row.status_conexao,
    });
  }

  const totalPorEstado = new Map(
    contatosResult.recordset.map((row) => [row.estado_id, row.total])
  );

  return estadosResult.recordset.map((estado) => ({
    estado: { id: estado.id, nome: estado.nome, uf: estado.uf },
    totalContatos: totalPorEstado.get(estado.id) || 0,
    numerosAtivos: numerosPorEstado.get(estado.id) || [],
  }));
}


async function listContatosDisponiveis(estadoId, { busca, ordem } = {}) {
  const pool = await getPool();
  const request = pool.request();
  request.input('estadoId', sql.Int, estadoId);

  let whereBusca = '';
  if (busca) {
    request.input('busca', sql.NVarChar, `%${busca}%`);
    whereBusca = 'AND (c.nome LIKE @busca OR c.telefone LIKE @busca)';
  }

  const orderBy = ORDENACOES[ordem] || ORDENACOES.nome_asc;

  const result = await request.query(`
    SELECT
      c.id,
      c.nome,
      c.telefone,
      ${SQL_DISPARADO_ULTIMOS_3_DIAS} AS disparado_ultimos_3_dias
    FROM Contatos c
    WHERE c.estado_id = @estadoId
    ${whereBusca}
    ORDER BY ${orderBy}
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    disparadoUltimos3Dias: Boolean(row.disparado_ultimos_3_dias),
  }));
}


async function validarNumeroEContatos({ estadoId, numeroRemetenteId, contatoIds }, executor) {
  const numeroRequest = new sql.Request(executor);
  numeroRequest.input('numeroId', sql.Int, numeroRemetenteId);
  const numeroResult = await numeroRequest.query(
    'SELECT id, estado_id, ativo, status_conexao, nome_colaboradora FROM NumerosRemetentes WHERE id = @numeroId'
  );
  const numero = numeroResult.recordset[0];

  if (!numero || numero.estado_id !== estadoId || !numero.ativo) {
    return { status: 'numero_invalido' };
  }

  if (numero.status_conexao !== 'conectado') {
    return { status: 'numero_desconectado' };
  }

  if (!numero.nome_colaboradora || !numero.nome_colaboradora.trim()) {
    return { status: 'numero_sem_colaboradora' };
  }

  const contatosRequest = new sql.Request(executor);
  contatosRequest.input('estadoId', sql.Int, estadoId);
  const placeholders = contatoIds.map((contatoId, index) => {
    const paramName = `contato${index}`;
    contatosRequest.input(paramName, sql.Int, contatoId);
    return `@${paramName}`;
  });
  const contatosResult = await contatosRequest.query(`
    SELECT
      c.id,
      c.nome,
      c.telefone,
      ${SQL_DISPARADO_ULTIMOS_3_DIAS} AS disparado_ultimos_3_dias
    FROM Contatos c
    WHERE c.estado_id = @estadoId AND c.id IN (${placeholders.join(', ')})
  `);

  if (contatosResult.recordset.length !== contatoIds.length) {
    return { status: 'contatos_invalidos' };
  }

  const avisos = contatosResult.recordset
    .filter((row) => row.disparado_ultimos_3_dias)
    .map((row) => ({ contatoId: row.id, nome: row.nome, telefone: row.telefone }));

  return { status: 'ok', avisos };
}

async function verificarDisparo({ estadoId, numeroRemetenteId, contatoIds }) {
  const pool = await getPool();
  return validarNumeroEContatos({ estadoId, numeroRemetenteId, contatoIds }, pool);
}

async function criarDisparo({ estadoId, numeroRemetenteId, usuarioId, contatoIds }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const validacao = await validarNumeroEContatos(
      { estadoId, numeroRemetenteId, contatoIds },
      transaction
    );

    if (validacao.status !== 'ok') {
      await transaction.rollback();
      return { status: validacao.status };
    }

    const disparoRequest = new sql.Request(transaction);
    disparoRequest.input('estadoId', sql.Int, estadoId);
    disparoRequest.input('numeroId', sql.Int, numeroRemetenteId);
    disparoRequest.input('usuarioId', sql.Int, usuarioId);
    const disparoResult = await disparoRequest.query(`
      INSERT INTO Disparos (estado_id, numero_remetente_id, usuario_id, status, criado_em)
      OUTPUT inserted.id
      VALUES (@estadoId, @numeroId, @usuarioId, 'pendente_envio', SYSUTCDATETIME())
    `);
    const disparoId = disparoResult.recordset[0].id;

    for (const contatoId of contatoIds) {
      const contatoRequest = new sql.Request(transaction);
      contatoRequest.input('disparoId', sql.Int, disparoId);
      contatoRequest.input('contatoId', sql.Int, contatoId);
      await contatoRequest.query(`
        INSERT INTO DisparoContatos (disparo_id, contato_id)
        VALUES (@disparoId, @contatoId)
      `);
    }

    await transaction.commit();
    return {
      status: 'criado',
      disparoId,
      totalContatos: contatoIds.length,
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listContatosPendentesParaEnvio(loteTamanho) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('loteTamanho', sql.Int, loteTamanho)
    .query(`
      SELECT TOP (@loteTamanho)
        dc.id AS disparo_contato_id,
        dc.disparo_id,
        d.numero_remetente_id,
        c.id AS contato_id,
        c.nome AS contato_nome,
        c.telefone AS contato_telefone
      FROM DisparoContatos dc
      JOIN Disparos d ON d.id = dc.disparo_id
      JOIN Contatos c ON c.id = dc.contato_id
      WHERE dc.status = 'pendente'
      ORDER BY dc.id ASC
    `);

  return result.recordset.map((row) => ({
    disparoContatoId: row.disparo_contato_id,
    disparoId: row.disparo_id,
    numeroRemetenteId: row.numero_remetente_id,
    contatoId: row.contato_id,
    contatoNome: row.contato_nome,
    contatoTelefone: row.contato_telefone,
  }));
}

async function marcarContatoFalha(disparoContatoId, erro) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, disparoContatoId)
    .input('erro', sql.NVarChar(500), String(erro).slice(0, 500))
    .query(`
      UPDATE DisparoContatos
      SET status = 'falha', erro = @erro
      WHERE id = @id
    `);
}

async function marcarContatoEnviado({ disparoContatoId, templateUsadoId, mensagemEnviada }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const dcRequest = new sql.Request(transaction);
    dcRequest.input('id', sql.Int, disparoContatoId);
    dcRequest.input('templateId', sql.Int, templateUsadoId);
    dcRequest.input('mensagem', sql.NVarChar(sql.MAX), mensagemEnviada);
    await dcRequest.query(`
      UPDATE DisparoContatos
      SET
        status = 'enviado',
        template_usado_id = @templateId,
        mensagem_enviada = @mensagem,
        enviado_em = SYSUTCDATETIME(),
        erro = NULL
      WHERE id = @id
    `);

    await mensagensTemplatesModel.setUltimoTemplateUsadoId(templateUsadoId, transaction);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function findDisparoDetalhe(id) {
  const pool = await getPool();

  const disparoResult = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT
        d.id AS disparo_id,
        e.id AS estado_id,
        e.nome AS estado_nome,
        e.uf AS estado_uf,
        n.id AS numero_id,
        n.apelido AS numero_apelido
      FROM Disparos d
      JOIN Estados e ON e.id = d.estado_id
      JOIN NumerosRemetentes n ON n.id = d.numero_remetente_id
      WHERE d.id = @id
    `);

  const disparoRow = disparoResult.recordset[0];
  if (!disparoRow) {
    return null;
  }

  const contatosResult = await pool
    .request()
    .input('disparoId', sql.Int, id)
    .query(`
      SELECT
        c.nome,
        c.telefone,
        dc.status,
        dc.mensagem_enviada,
        dc.enviado_em,
        dc.erro
      FROM DisparoContatos dc
      JOIN Contatos c ON c.id = dc.contato_id
      WHERE dc.disparo_id = @disparoId
      ORDER BY dc.id ASC
    `);

  return {
    disparoId: disparoRow.disparo_id,
    estado: { id: disparoRow.estado_id, nome: disparoRow.estado_nome, uf: disparoRow.estado_uf },
    numeroRemetente: { id: disparoRow.numero_id, apelido: disparoRow.numero_apelido },
    contatos: contatosResult.recordset.map((row) => ({
      nome: row.nome,
      telefone: row.telefone,
      status: row.status,
      mensagemEnviada: row.mensagem_enviada,
      enviadoEm: row.enviado_em,
      erro: row.erro,
    })),
  };
}

module.exports = {
  listPainelDisparo,
  listContatosDisponiveis,
  verificarDisparo,
  criarDisparo,
  listContatosPendentesParaEnvio,
  marcarContatoFalha,
  marcarContatoEnviado,
  findDisparoDetalhe,
};
