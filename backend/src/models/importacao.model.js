const { sql, getPool } = require('../config/db');

async function listEstadoDDDs() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ed.ddd, e.id AS estado_id, e.nome AS estado_nome, e.uf AS estado_uf
    FROM EstadoDDDs ed
    JOIN Estados e ON e.id = ed.estado_id
  `);
  return result.recordset;
}

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
    SELECT id, telefone FROM Contatos WHERE telefone IN (${placeholders.join(', ')})
  `);
  return result.recordset;
}

async function criarLoteEContatos({
  nomeArquivo,
  usuarioId,
  totalLinhas,
  totalSemEstado,
  totalDuplicado,
  totalErro,
  contatos,
  erros,
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
        (nome_arquivo, usuario_id, total_linhas, total_sem_estado, total_duplicado, total_erro, criado_em)
      OUTPUT inserted.id, inserted.criado_em
      VALUES (@nomeArquivo, @usuarioId, @totalLinhas, @totalSemEstado, @totalDuplicado, @totalErro, SYSUTCDATETIME())
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

    for (const erro of erros || []) {
      const erroRequest = new sql.Request(transaction);
      erroRequest.input('loteId', sql.Int, lote.id);
      erroRequest.input('linha', sql.Int, erro.linha ?? null);
      erroRequest.input('tipo', sql.VarChar(20), erro.tipo);
      erroRequest.input('nomePlanilha', sql.NVarChar(150), erro.nomePlanilha ?? null);
      erroRequest.input('contatoPlanilha', sql.VarChar(30), erro.contatoPlanilha ?? null);
      erroRequest.input('motivo', sql.NVarChar(255), erro.motivo);
      erroRequest.input('contatoExistenteId', sql.Int, erro.contatoExistenteId ?? null);
      await erroRequest.query(`
        INSERT INTO LoteImportacaoErros
          (lote_importacao_id, linha, tipo, nome_planilha, contato_planilha, motivo, contato_existente_id, criado_em)
        VALUES (@loteId, @linha, @tipo, @nomePlanilha, @contatoPlanilha, @motivo, @contatoExistenteId, SYSUTCDATETIME())
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

async function listHistorico() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      li.id AS loteImportacaoId,
      li.nome_arquivo AS nomeArquivo,
      u.email AS usuarioEmail,
      li.total_linhas AS totalLinhas,
      (li.total_linhas - li.total_sem_estado - li.total_duplicado - li.total_erro) AS totalImportados,
      li.total_sem_estado AS totalSemEstado,
      li.total_duplicado AS totalDuplicado,
      li.total_erro AS totalErro,
      li.criado_em AS criado_em
    FROM LotesImportacao li
    LEFT JOIN Usuarios u ON u.id = li.usuario_id
    ORDER BY li.criado_em DESC
  `);
  return result.recordset;
}

async function getDetalheLote(loteId) {
  const pool = await getPool();

  const loteRequest = pool.request();
  loteRequest.input('loteId', sql.Int, loteId);
  const loteResult = await loteRequest.query(`
    SELECT
      li.id AS loteImportacaoId,
      li.nome_arquivo AS nomeArquivo,
      u.email AS usuarioEmail,
      li.total_linhas AS totalLinhas,
      (li.total_linhas - li.total_sem_estado - li.total_duplicado - li.total_erro) AS totalImportados,
      li.total_sem_estado AS totalSemEstado,
      li.total_duplicado AS totalDuplicado,
      li.total_erro AS totalErro,
      li.criado_em AS criado_em
    FROM LotesImportacao li
    LEFT JOIN Usuarios u ON u.id = li.usuario_id
    WHERE li.id = @loteId
  `);
  const lote = loteResult.recordset[0];

  if (!lote) {
    return null;
  }

  const porEstadoRequest = pool.request();
  porEstadoRequest.input('loteId', sql.Int, loteId);
  const porEstadoResult = await porEstadoRequest.query(`
    SELECT e.id, e.nome, e.uf, COUNT(*) AS totalContatos
    FROM Contatos c
    JOIN Estados e ON e.id = c.estado_id
    WHERE c.lote_importacao_id = @loteId
    GROUP BY e.id, e.nome, e.uf
    ORDER BY e.nome
  `);

  const errosRequest = pool.request();
  errosRequest.input('loteId', sql.Int, loteId);
  const errosResult = await errosRequest.query(`
    SELECT
      linha,
      tipo,
      nome_planilha AS nomePlanilha,
      contato_planilha AS contatoPlanilha,
      motivo,
      contato_existente_id AS contatoExistenteId
    FROM LoteImportacaoErros
    WHERE lote_importacao_id = @loteId
    ORDER BY linha ASC, id ASC
  `);

  return {
    ...lote,
    porEstado: porEstadoResult.recordset.map((row) => ({
      estado: { id: row.id, nome: row.nome, uf: row.uf },
      totalContatos: row.totalContatos,
    })),
    erros: errosResult.recordset,
  };
}

module.exports = {
  listEstadoDDDs,
  listTelefonesExistentes,
  criarLoteEContatos,
  listHistorico,
  getDetalheLote,
};
