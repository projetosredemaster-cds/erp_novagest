const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Ranking.
 *
 * Depois da extração do CRUD de Diretor/Rede/Responsavel para o módulo
 * Cadastros (ver CONTRATO-RANKING-API.md v3 e CONTRATO-CADASTROS-API.md),
 * este model é dono só de `Entradas` (lançamento diário por Rede) e
 * `Categorias`. O JOIN com `Redes` em `listEntradas` é só LEITURA (para
 * montar `rede_nome`/`rede_emoji`/`diretor_id` nas Entradas) — CRUD de Rede
 * vive em `cadastros.model.js`.
 *
 *   - Categorias  (id, nome, principal, criado_em) — sem mudança.
 *   - Entradas    (id, data_ref, categoria_id -> FK Categorias, rede_id -> FK
 *                 Redes, valor, atualizado_em; UNIQUE em
 *                 data_ref+categoria_id+rede_id).
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 */

async function listEntradas({ data, categoriaId }) {
  const pool = await getPool();
  const request = pool.request();
  request.input('data', sql.Date, data);
  request.input('categoriaId', sql.Int, categoriaId);

  const result = await request.query(`
    SELECT
      e.id,
      e.data_ref,
      e.categoria_id,
      e.rede_id,
      e.valor,
      e.atualizado_em,
      r.nome  AS rede_nome,
      r.emoji AS rede_emoji,
      r.diretor_id
    FROM Entradas e
    INNER JOIN Redes r ON r.id = e.rede_id
    WHERE e.data_ref = @data
      AND e.categoria_id = @categoriaId
    ORDER BY e.valor DESC
  `);

  return result.recordset;
}

/**
 * Remove a entrada correspondente a (data_ref, categoria_id, rede_id), se
 * existir. Idempotente por design — não lança/sinaliza erro se a linha não
 * existir (ver CONTRATO-RANKING-API.md, seção 4).
 */
async function deleteEntrada({ data, categoriaId, redeId }) {
  const pool = await getPool();
  const request = pool.request();
  request.input('data', sql.Date, data);
  request.input('categoriaId', sql.Int, categoriaId);
  request.input('redeId', sql.Int, redeId);

  await request.query(`
    DELETE FROM Entradas
    WHERE data_ref = @data
      AND categoria_id = @categoriaId
      AND rede_id = @redeId
  `);
}

/**
 * Cria ou atualiza (upsert) uma entrada, identificada pela combinação
 * (data_ref, categoria_id, rede_id), usando MERGE dentro de uma transação.
 */
async function upsertEntrada({ data, categoriaId, redeId, valor }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request.input('data', sql.Date, data);
    request.input('categoriaId', sql.Int, categoriaId);
    request.input('redeId', sql.Int, redeId);
    request.input('valor', sql.Decimal(18, 2), valor);

    const result = await request.query(`
      MERGE INTO Entradas AS target
      USING (SELECT @data AS data_ref, @categoriaId AS categoria_id, @redeId AS rede_id) AS source
        ON target.data_ref = source.data_ref
        AND target.categoria_id = source.categoria_id
        AND target.rede_id = source.rede_id
      WHEN MATCHED THEN
        UPDATE SET valor = @valor, atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, categoria_id, rede_id, valor, atualizado_em)
        VALUES (@data, @categoriaId, @redeId, @valor, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.data_ref,
        inserted.categoria_id,
        inserted.rede_id,
        inserted.valor,
        inserted.atualizado_em;
    `);

    await transaction.commit();
    return result.recordset[0];
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function listCategorias() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, principal, criado_em
    FROM Categorias
    ORDER BY nome
  `);
  return result.recordset;
}

module.exports = {
  listEntradas,
  upsertEntrada,
  deleteEntrada,
  listCategorias,
};
