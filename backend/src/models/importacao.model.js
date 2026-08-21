const { sql, getPool } = require('../config/db');

/**
 * Todos os DDDs cadastrados, com o Estado dono de cada um — usado para
 * agrupar os contatos da planilha por Estado sem 1 query por linha.
 */
async function listEstadoDDDs() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ed.ddd, e.id AS estado_id, e.nome AS estado_nome, e.uf AS estado_uf
    FROM EstadoDDDs ed
    JOIN Estados e ON e.id = ed.estado_id
  `);
  return result.recordset;
}

/**
 * Dos telefones informados, devolve os que já existem em Contatos (de
 * qualquer lote, confirmado ou não) — telefone é UNIQUE globalmente.
 * Cada telefone é seu próprio parâmetro (nunca concatenado na string SQL).
 */
async function listTelefonesExistentes(telefones) {
  if (!telefones || telefones.length === 0) {
    return [];
  }

  const pool = await getPool();
  const request = pool.request();
  const placeholders = telefones.map((telefone, index) => {
    const paramName = `tel${index}`;
    request.input(paramName, sql.VarChar, telefone);
    return `@${paramName}`;
  });

  const result = await request.query(`
    SELECT telefone FROM Contatos WHERE telefone IN (${placeholders.join(', ')})
  `);
  return result.recordset.map((row) => row.telefone);
}

/**
 * Cria o LotesImportacao e todos os Contatos válidos (com/sem Estado) numa
 * única transação, e devolve o resumo por Estado (porEstado). Nunca atribui
 * numero_remetente_id — isso só acontece na confirmação.
 */
async function criarLoteEContatos({
  nomeArquivo,
  usuarioId,
  totalLinhas,
  totalSemEstado,
  totalDuplicado,
  totalErro,
  contatos,
}) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const loteRequest = new sql.Request(transaction);
    loteRequest.input('nomeArquivo', sql.NVarChar, nomeArquivo);
    loteRequest.input('usuarioId', sql.Int, usuarioId);
    loteRequest.input('totalLinhas', sql.Int, totalLinhas);
    loteRequest.input('totalSemEstado', sql.Int, totalSemEstado);
    loteRequest.input('totalDuplicado', sql.Int, totalDuplicado);
    loteRequest.input('totalErro', sql.Int, totalErro);
    const loteResult = await loteRequest.query(`
      INSERT INTO LotesImportacao
        (nome_arquivo, usuario_id, total_linhas, total_sem_estado, total_duplicado, total_erro, confirmado, criado_em)
      OUTPUT inserted.id, inserted.criado_em
      VALUES (@nomeArquivo, @usuarioId, @totalLinhas, @totalSemEstado, @totalDuplicado, @totalErro, 0, SYSUTCDATETIME())
    `);
    const lote = loteResult.recordset[0];

    for (const contato of contatos) {
      const contatoRequest = new sql.Request(transaction);
      contatoRequest.input('nome', sql.NVarChar, contato.nome);
      contatoRequest.input('telefone', sql.VarChar, contato.telefone);
      contatoRequest.input('ddd', sql.Char(2), contato.ddd);
      contatoRequest.input('estadoId', sql.Int, contato.estadoId);
      contatoRequest.input('loteId', sql.Int, lote.id);
      await contatoRequest.query(`
        INSERT INTO Contatos (nome, telefone, ddd, estado_id, numero_remetente_id, lote_importacao_id, criado_em)
        VALUES (@nome, @telefone, @ddd, @estadoId, NULL, @loteId, SYSUTCDATETIME())
      `);
    }

    const porEstadoRequest = new sql.Request(transaction);
    porEstadoRequest.input('loteId', sql.Int, lote.id);
    const porEstadoResult = await porEstadoRequest.query(`
      SELECT e.id, e.nome, e.uf, COUNT(*) AS totalContatos
      FROM Contatos c
      JOIN Estados e ON e.id = c.estado_id
      WHERE c.lote_importacao_id = @loteId
      GROUP BY e.id, e.nome, e.uf
      ORDER BY e.nome
    `);

    await transaction.commit();

    return {
      loteImportacaoId: lote.id,
      criado_em: lote.criado_em,
      porEstado: porEstadoResult.recordset.map((row) => ({
        estado: { id: row.id, nome: row.nome, uf: row.uf },
        totalContatos: row.totalContatos,
      })),
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function getEstadoNomeEmTransacao(transaction, estadoId) {
  const request = new sql.Request(transaction);
  request.input('estadoId', sql.Int, estadoId);
  const result = await request.query('SELECT nome FROM Estados WHERE id = @estadoId');
  return result.recordset[0] ? result.recordset[0].nome : `#${estadoId}`;
}

/**
 * Confirma a distribuição de números por Estado de um lote, em transação:
 * 1) valida lote existe/não confirmado; 2) valida cada escolha (Estado com
 * pendentes, número pertence ao Estado e está ativo); 3) valida que todo
 * Estado com contato pendente recebeu uma escolha; 4) efetiva UPDATE +
 * INSERT em LoteImportacaoEscolhas + marca o lote como confirmado.
 * Retorna { status: 'lote_nao_encontrado' | 'ja_confirmado' | 'numero_invalido' (com estadoNome) |
 * 'faltando_escolha' | 'confirmado' }.
 */
async function confirmarLote({ loteId, escolhas }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const loteRequest = new sql.Request(transaction);
    loteRequest.input('loteId', sql.Int, loteId);
    const loteResult = await loteRequest.query('SELECT id, confirmado FROM LotesImportacao WHERE id = @loteId');
    const lote = loteResult.recordset[0];

    if (!lote) {
      await transaction.rollback();
      return { status: 'lote_nao_encontrado' };
    }

    if (lote.confirmado) {
      await transaction.rollback();
      return { status: 'ja_confirmado' };
    }

    const pendentesRequest = new sql.Request(transaction);
    pendentesRequest.input('loteId', sql.Int, loteId);
    const pendentesResult = await pendentesRequest.query(`
      SELECT c.estado_id, e.nome AS estado_nome, COUNT(*) AS total
      FROM Contatos c
      JOIN Estados e ON e.id = c.estado_id
      WHERE c.lote_importacao_id = @loteId
        AND c.estado_id IS NOT NULL
        AND c.numero_remetente_id IS NULL
      GROUP BY c.estado_id, e.nome
    `);
    const pendentesPorEstado = new Map(pendentesResult.recordset.map((row) => [row.estado_id, row]));

    for (const escolha of escolhas) {
      const { estadoId, numeroRemetenteId } = escolha;
      const pendente = pendentesPorEstado.get(estadoId);

      if (!pendente) {
        const estadoNome = await getEstadoNomeEmTransacao(transaction, estadoId);
        await transaction.rollback();
        return { status: 'numero_invalido', estadoNome };
      }

      const numeroRequest = new sql.Request(transaction);
      numeroRequest.input('numeroId', sql.Int, numeroRemetenteId);
      const numeroResult = await numeroRequest.query(
        'SELECT id, estado_id, ativo FROM NumerosRemetentes WHERE id = @numeroId'
      );
      const numero = numeroResult.recordset[0];

      if (!numero || numero.estado_id !== estadoId || !numero.ativo) {
        await transaction.rollback();
        return { status: 'numero_invalido', estadoNome: pendente.estado_nome };
      }
    }

    const estadosComEscolha = new Set(escolhas.map((escolha) => escolha.estadoId));
    for (const estadoId of pendentesPorEstado.keys()) {
      if (!estadosComEscolha.has(estadoId)) {
        await transaction.rollback();
        return { status: 'faltando_escolha' };
      }
    }

    for (const escolha of escolhas) {
      const { estadoId, numeroRemetenteId } = escolha;

      const updateRequest = new sql.Request(transaction);
      updateRequest.input('numeroId', sql.Int, numeroRemetenteId);
      updateRequest.input('loteId', sql.Int, loteId);
      updateRequest.input('estadoId', sql.Int, estadoId);
      const updateResult = await updateRequest.query(`
        UPDATE Contatos
        SET numero_remetente_id = @numeroId
        WHERE lote_importacao_id = @loteId AND estado_id = @estadoId AND numero_remetente_id IS NULL
      `);
      const totalContatos = updateResult.rowsAffected[0];

      const insertRequest = new sql.Request(transaction);
      insertRequest.input('loteId', sql.Int, loteId);
      insertRequest.input('estadoId', sql.Int, estadoId);
      insertRequest.input('numeroId', sql.Int, numeroRemetenteId);
      insertRequest.input('totalContatos', sql.Int, totalContatos);
      await insertRequest.query(`
        INSERT INTO LoteImportacaoEscolhas (lote_importacao_id, estado_id, numero_remetente_id, total_contatos)
        VALUES (@loteId, @estadoId, @numeroId, @totalContatos)
      `);
    }

    const confirmarRequest = new sql.Request(transaction);
    confirmarRequest.input('loteId', sql.Int, loteId);
    await confirmarRequest.query('UPDATE LotesImportacao SET confirmado = 1 WHERE id = @loteId');

    await transaction.commit();
    return { status: 'confirmado' };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listLotesPendentes() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      id AS loteImportacaoId,
      nome_arquivo AS nomeArquivo,
      (total_linhas - total_sem_estado - total_duplicado - total_erro) AS totalImportados,
      criado_em
    FROM LotesImportacao
    WHERE confirmado = 0
    ORDER BY criado_em DESC
  `);
  return result.recordset;
}

module.exports = {
  listEstadoDDDs,
  listTelefonesExistentes,
  criarLoteEContatos,
  confirmarLote,
  listLotesPendentes,
};
