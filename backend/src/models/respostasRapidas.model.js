const { sql, getPool } = require('../config/db');

function mapRespostaRow(row) {
  const { criado_em: criadoEm, ...resto } = row;
  return {
    ...resto,
    criadoEm,
  };
}

async function listAtivas() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, titulo, corpo, ordem, ativo, criado_em
    FROM RespostasRapidas
    WHERE ativo = 1
    ORDER BY ordem ASC, id ASC
  `);
  return result.recordset.map(mapRespostaRow);
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, titulo, corpo, ordem, ativo, criado_em
      FROM RespostasRapidas
      WHERE id = @id
    `);
  const row = result.recordset[0];
  return row ? mapRespostaRow(row) : undefined;
}

async function insertResposta({ titulo, corpo, ordem }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('titulo', sql.NVarChar, titulo)
    .input('corpo', sql.NVarChar(sql.MAX), corpo)
    .input('ordem', sql.Int, ordem)
    .query(`
      INSERT INTO RespostasRapidas (titulo, corpo, ordem, ativo, criado_em)
      OUTPUT inserted.id
      VALUES (@titulo, @corpo, @ordem, 1, SYSUTCDATETIME())
    `);

  return findById(result.recordset[0].id);
}

async function updateResposta(id, { titulo, corpo, ordem, ativo }) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('id', sql.Int, id)
    .input('titulo', sql.NVarChar, titulo ?? null)
    .input('corpo', sql.NVarChar(sql.MAX), corpo ?? null)
    .input('ordem', sql.Int, ordem !== undefined ? ordem : null)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null);

  const sets = [
    'titulo = COALESCE(@titulo, titulo)',
    'corpo = COALESCE(@corpo, corpo)',
    'ordem = COALESCE(@ordem, ordem)',
    'ativo = COALESCE(@ativo, ativo)',
  ];

  await request.query(`
    UPDATE RespostasRapidas
    SET ${sets.join(', ')}
    WHERE id = @id
  `);
}

async function deleteResposta(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM RespostasRapidas WHERE id = @id');
  return result.rowsAffected[0] > 0;
}

module.exports = {
  listAtivas,
  findById,
  insertResposta,
  updateResposta,
  deleteResposta,
};
