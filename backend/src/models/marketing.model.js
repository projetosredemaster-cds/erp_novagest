const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Marketing.
 *
 * Dono só de `MarketingEntradas` (lançamento mensal de faturamento
 * geral/marketing/retorno-indicação por Loja física). Diretor/Rede/Loja
 * são cadastro compartilhado — o CRUD deles vive em `cadastros.model.js`;
 * este model só faz JOIN de LEITURA nessas tabelas para montar a listagem
 * agrupada (Diretor -> Rede -> Loja) e para validar a existência de
 * `lojaId` no upsert de entrada (mesmo princípio de `margens.model.js`).
 *
 *   - MarketingEntradas (id, data_ref, loja_id -> FK Lojas,
 *                        faturamento_geral, faturamento_marketing,
 *                        faturamento_retorno_indicacao, atualizado_em;
 *                        UNIQUE em data_ref+loja_id).
 *
 * `data_ref` é sempre o dia 1 do mês/ano do lançamento (convenção de "mês
 * como data", mesmo padrão de outras tabelas do sistema).
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 */

/**
 * Lista todas as Lojas ativas, já com Rede + Diretor (JOIN de leitura), e o
 * lançamento de marketing do mês pedido (`dataRef`) e do mês anterior
 * (`dataRefAnterior`), via LEFT JOIN duplo em `MarketingEntradas` — uma loja
 * sem lançamento em um dos dois meses simplesmente vem com essas colunas
 * `NULL`. Quem calcula percentuais/comparação/agrupamento é o service (ver
 * CONTRATO-MARKETING-API.md, seção 1).
 */
async function listLojasAtivasComEntradas({ dataRef, dataRefAnterior }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('dataRef', sql.Date, dataRef)
    .input('dataRefAnterior', sql.Date, dataRefAnterior)
    .query(`
      SELECT
        d.id AS diretor_id,
        d.nome AS diretor_nome,
        r.id AS rede_id,
        r.nome AS rede_nome,
        l.id AS loja_id,
        l.nome AS loja_nome,
        me.faturamento_geral AS faturamentoGeral,
        me.faturamento_marketing AS faturamentoMarketing,
        me.faturamento_retorno_indicacao AS faturamentoRetornoIndicacao,
        me.atualizado_em AS atualizadoEm,
        mePrev.faturamento_geral AS faturamentoGeralAnterior,
        mePrev.faturamento_marketing AS faturamentoMarketingAnterior,
        mePrev.faturamento_retorno_indicacao AS faturamentoRetornoIndicacaoAnterior
      FROM Lojas l
      INNER JOIN Redes r ON r.id = l.rede_id
      INNER JOIN Diretores d ON d.id = r.diretor_id
      LEFT JOIN MarketingEntradas me
        ON me.loja_id = l.id AND me.data_ref = @dataRef
      LEFT JOIN MarketingEntradas mePrev
        ON mePrev.loja_id = l.id AND mePrev.data_ref = @dataRefAnterior
      WHERE l.ativo = 1 AND r.ativo = 1
      ORDER BY d.nome, r.nome, l.nome
    `);
  return result.recordset;
}

/**
 * Verifica se existe uma loja com o `id` informado. Usada pela validação de
 * `lojaId` no upsert de entrada de marketing (ver CONTRATO-MARKETING-API.md,
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
 * Cria ou atualiza (upsert) uma entrada de marketing, identificada pela
 * combinação (data_ref, loja_id), usando MERGE dentro de uma transação
 * (mesmo padrão de `upsertEntrada` em `margens.model.js`/`ranking.model.js`).
 */
async function upsertEntrada({ dataRef, lojaId, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request.input('dataRef', sql.Date, dataRef);
    request.input('lojaId', sql.Int, lojaId);
    request.input('faturamentoGeral', sql.Decimal(18, 2), faturamentoGeral);
    request.input('faturamentoMarketing', sql.Decimal(18, 2), faturamentoMarketing);
    request.input('faturamentoRetornoIndicacao', sql.Decimal(18, 2), faturamentoRetornoIndicacao);

    const result = await request.query(`
      MERGE INTO MarketingEntradas AS target
      USING (SELECT @dataRef AS data_ref, @lojaId AS loja_id) AS source
        ON target.data_ref = source.data_ref
        AND target.loja_id = source.loja_id
      WHEN MATCHED THEN
        UPDATE SET
          faturamento_geral = @faturamentoGeral,
          faturamento_marketing = @faturamentoMarketing,
          faturamento_retorno_indicacao = @faturamentoRetornoIndicacao,
          atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, loja_id, faturamento_geral, faturamento_marketing, faturamento_retorno_indicacao, atualizado_em)
        VALUES (@dataRef, @lojaId, @faturamentoGeral, @faturamentoMarketing, @faturamentoRetornoIndicacao, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.loja_id AS lojaId,
        inserted.data_ref AS dataRef,
        inserted.faturamento_geral AS faturamentoGeral,
        inserted.faturamento_marketing AS faturamentoMarketing,
        inserted.faturamento_retorno_indicacao AS faturamentoRetornoIndicacao,
        inserted.atualizado_em AS atualizadoEm;
    `);

    await transaction.commit();
    return result.recordset[0];
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Remove a entrada correspondente a (data_ref, loja_id), se existir.
 * Idempotente por design — não lança/sinaliza erro se a linha não existir
 * (ver CONTRATO-MARKETING-API.md, seção 3), mesmo padrão de
 * `ranking.model.js: deleteEntrada`.
 */
async function deleteEntrada({ dataRef, lojaId }) {
  const pool = await getPool();
  const request = pool.request();
  request.input('dataRef', sql.Date, dataRef);
  request.input('lojaId', sql.Int, lojaId);

  await request.query(`
    DELETE FROM MarketingEntradas
    WHERE data_ref = @dataRef
      AND loja_id = @lojaId
  `);
}

module.exports = {
  listLojasAtivasComEntradas,
  existeLoja,
  upsertEntrada,
  deleteEntrada,
};
