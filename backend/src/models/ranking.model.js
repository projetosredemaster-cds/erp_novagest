const { sql, getPool } = require('../config/db');

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
    SELECT id, nome, principal, padrao, visivel, criado_em
    FROM Categorias
    ORDER BY nome
  `);
  return result.recordset;
}
async function existeCategoriaComNome(nome, excludeId = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .input('excludeId', sql.Int, excludeId)
    .query(`
      SELECT COUNT(*) AS total
      FROM Categorias
      WHERE LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
        AND (@excludeId IS NULL OR id <> @excludeId)
    `);
  return result.recordset[0].total > 0;
}
async function insertCategoria({ nome }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .query(`
      INSERT INTO Categorias (nome, principal, padrao, visivel, criado_em)
      OUTPUT inserted.id, inserted.nome, inserted.principal, inserted.padrao,
             inserted.visivel, inserted.criado_em
      VALUES (@nome, 0, 0, 1, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}
async function findCategoriaById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, nome, principal, padrao, visivel, criado_em
      FROM Categorias
      WHERE id = @id
    `);
  return result.recordset[0];
}
async function updateCategoria(id, { nome, visivel }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('visivel', sql.Bit, visivel !== undefined ? visivel : null)
    .input('visivelInformado', sql.Bit, visivel !== undefined ? 1 : 0)
    .query(`
      UPDATE Categorias
      SET
        nome = COALESCE(@nome, nome),
        visivel = CASE WHEN @visivelInformado = 1 THEN @visivel ELSE visivel END
      WHERE id = @id
    `);
}
async function deleteCategoriaIfAllowed(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const categoriaRequest = new sql.Request(transaction);
    categoriaRequest.input('id', sql.Int, id);
    const categoriaResult = await categoriaRequest.query(
      'SELECT id, padrao FROM Categorias WHERE id = @id'
    );

    const categoria = categoriaResult.recordset[0];
    if (!categoria) {
      await transaction.rollback();
      return 'not_found';
    }

    if (categoria.padrao) {
      await transaction.rollback();
      return 'is_padrao';
    }

    const countRequest = new sql.Request(transaction);
    countRequest.input('categoriaId', sql.Int, id);
    const countResult = await countRequest.query(
      'SELECT COUNT(*) AS total FROM Entradas WHERE categoria_id = @categoriaId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_entradas';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM Categorias WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listEntradas,
  upsertEntrada,
  deleteEntrada,
  listCategorias,
  existeCategoriaComNome,
  insertCategoria,
  findCategoriaById,
  updateCategoria,
  deleteCategoriaIfAllowed,
};
