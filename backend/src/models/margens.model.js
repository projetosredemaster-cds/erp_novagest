const { sql, getPool } = require('../config/db');

async function listEntradasPorData(data) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('data', sql.Date, data)
    .query(`
      SELECT id, data_ref, loja_id, faturamento, custos AS custoProduto,
             cartoes AS totalTar, franquia AS margemInformada, atualizado_em
      FROM MargensEntradas
      WHERE data_ref = @data
      ORDER BY loja_id
    `);
  return result.recordset;
}
async function existeLoja(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Lojas WHERE id = @id');
  return result.recordset.length > 0;
}
async function upsertEntrada({ data, lojaId, faturamento, custoProduto, totalTar, margemInformada }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request.input('data', sql.Date, data);
    request.input('lojaId', sql.Int, lojaId);
    request.input('faturamento', sql.Decimal(18, 2), faturamento);
    request.input('custoProduto', sql.Decimal(18, 2), custoProduto);
    request.input('totalTar', sql.Decimal(18, 2), totalTar);
    request.input('margemInformada', sql.Decimal(18, 2), margemInformada || 0);

    const result = await request.query(`
      MERGE INTO MargensEntradas AS target
      USING (SELECT @data AS data_ref, @lojaId AS loja_id) AS source
        ON target.data_ref = source.data_ref
        AND target.loja_id = source.loja_id
      WHEN MATCHED THEN
        UPDATE SET
          faturamento = @faturamento,
          franquia = @margemInformada,
          custos = @custoProduto,
          cartoes = @totalTar,
          despesas = 0,
          atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, loja_id, faturamento, franquia, custos, cartoes, despesas, atualizado_em)
        VALUES (@data, @lojaId, @faturamento, @margemInformada, @custoProduto, @totalTar, 0, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.data_ref,
        inserted.loja_id,
        inserted.faturamento,
        inserted.custos AS custoProduto,
        inserted.cartoes AS totalTar,
        inserted.franquia AS margemInformada,
        inserted.atualizado_em;
    `);

    await transaction.commit();
    return result.recordset[0];
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
async function getSomasPorLojaNoPeriodo({ dataInicio, dataFim }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('dataInicio', sql.Date, dataInicio)
    .input('dataFim', sql.Date, dataFim)
    .query(`
      SELECT
        l.id AS loja_id,
        l.nome AS loja_nome,
        r.id AS rede_id,
        r.nome AS rede_nome,
        resp.id AS responsavel_id,
        resp.nome AS responsavel_nome,
        d.id AS diretor_id,
        d.nome AS diretor_nome,
        SUM(me.faturamento) AS faturamento,
        SUM(me.custos) AS custoProduto,
        SUM(me.cartoes) AS totalTar
      FROM MargensEntradas me
      INNER JOIN Lojas l ON l.id = me.loja_id
      INNER JOIN Redes r ON r.id = l.rede_id
      INNER JOIN Diretores d ON d.id = r.diretor_id
      LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
      WHERE me.data_ref BETWEEN @dataInicio AND @dataFim
      GROUP BY l.id, l.nome, r.id, r.nome, resp.id, resp.nome, d.id, d.nome
      ORDER BY d.nome, r.nome, l.nome
    `);
  return result.recordset;
}

module.exports = {
  listEntradasPorData,
  existeLoja,
  upsertEntrada,
  getSomasPorLojaNoPeriodo,
};
