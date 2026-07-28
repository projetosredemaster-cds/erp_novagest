const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Margens.
 *
 * Dono só de `MargensEntradas` (lançamento diário de margem por Loja) e da
 * leitura agregada usada pelo relatório de período. Diretor/Rede/Loja/
 * Responsavel são cadastro compartilhado — o CRUD deles vive em
 * `cadastros.model.js`; este model só faz JOIN de LEITURA nessas tabelas
 * para montar o relatório agrupado (Diretor -> Rede -> Loja) e para validar
 * a existência de `lojaId` no upsert de entrada.
 *
 *   - MargensEntradas (id, data_ref, loja_id -> FK Lojas, faturamento,
 *                     franquia, custos, cartoes, despesas, atualizado_em;
 *                     UNIQUE em data_ref+loja_id).
 *
 * A API (CONTRATO-MARGENS-API.md v4) trata `faturamento` e `custoProduto`
 * como valores CONSOLIDADOS DA FRANQUIA (o mesmo número vale pra todas as
 * lojas num dado dia) — o único valor específico de cada loja é `totalTar`
 * (taxa de cartão daquela unidade). Ao confirmar uma loja, o snapshot do
 * faturamento/custoProduto usados naquele momento é gravado junto com o
 * totalTar da loja — histórico intencional, pra sobreviver a mudanças
 * futuras nos valores consolidados. Isso reaproveita as 5 colunas que a
 * tabela já tem, sem alterar schema: `faturamento` = snapshot do
 * faturamento consolidado; `custos` = snapshot do custo geral de produtos;
 * `cartoes` = totalTar da loja; `franquia`/`despesas` sempre `0` (não
 * usadas nesta versão).
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 */

/**
 * Lista todos os lançamentos de margem já confirmados numa data específica.
 */
async function listEntradasPorData(data) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('data', sql.Date, data)
    .query(`
      SELECT id, data_ref, loja_id, faturamento, custos AS custoProduto,
             cartoes AS totalTar, atualizado_em
      FROM MargensEntradas
      WHERE data_ref = @data
      ORDER BY loja_id
    `);
  return result.recordset;
}

/**
 * Verifica se existe uma loja com o `id` informado. Usada pela validação de
 * `lojaId` no upsert de entrada de margem (ver CONTRATO-MARGENS-API.md,
 * seção 2). Só leitura — o CRUD de Loja é do módulo Cadastros.
 */
async function existeLoja(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Lojas WHERE id = @id');
  return result.recordset.length > 0;
}

/**
 * Cria ou atualiza (upsert) uma entrada de margem, identificada pela
 * combinação (data_ref, loja_id), usando MERGE dentro de uma transação
 * (mesmo padrão de `upsertEntrada` em `ranking.model.js`). Grava sempre
 * franquia/despesas como 0 — colunas mantidas no schema mas não usadas
 * nesta versão (ver CONTRATO-MARGENS-API.md v4).
 */
async function upsertEntrada({ data, lojaId, faturamento, custoProduto, totalTar }) {
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

    const result = await request.query(`
      MERGE INTO MargensEntradas AS target
      USING (SELECT @data AS data_ref, @lojaId AS loja_id) AS source
        ON target.data_ref = source.data_ref
        AND target.loja_id = source.loja_id
      WHEN MATCHED THEN
        UPDATE SET
          faturamento = @faturamento,
          franquia = 0,
          custos = @custoProduto,
          cartoes = @totalTar,
          despesas = 0,
          atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, loja_id, faturamento, franquia, custos, cartoes, despesas, atualizado_em)
        VALUES (@data, @lojaId, @faturamento, 0, @custoProduto, @totalTar, 0, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.data_ref,
        inserted.loja_id,
        inserted.faturamento,
        inserted.custos AS custoProduto,
        inserted.cartoes AS totalTar,
        inserted.atualizado_em;
    `);

    await transaction.commit();
    return result.recordset[0];
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Soma, por loja, todos os lançamentos de margem cuja `data_ref` cai dentro
 * de [dataInicio, dataFim] (inclusive) — cada dia somado com seu próprio
 * snapshot de faturamento/custoProduto e o totalTar daquele dia — já
 * trazendo Rede + Diretor + Responsavel (GG) via JOIN de leitura, para o
 * relatório agrupado (ver CONTRATO-MARGENS-API.md, seção 3). Só lojas com
 * pelo menos um lançamento no período aparecem no resultado (INNER JOIN
 * com MargensEntradas) — quem calcula lucro/percentual/cor em cima destes
 * totais é o service.
 */
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
