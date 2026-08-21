const { sql, getPool } = require('../config/db');
async function findByEmailForLogin(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT id, email, senha_hash AS senhaHash, is_admin AS isAdmin, role
      FROM Usuarios
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);
  return result.recordset[0];
}

async function findByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT id, email, is_admin AS isAdmin
      FROM Usuarios
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);
  return result.recordset[0];
}

async function findById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      SELECT id, email, is_admin AS isAdmin, criado_em
      FROM Usuarios
      WHERE id = @id
    `);
  return result.recordset[0];
}

async function listAll() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, email, is_admin AS isAdmin, role, criado_em
    FROM Usuarios
    ORDER BY email
  `);
  return result.recordset;
}

async function existeEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT COUNT(*) AS total
      FROM Usuarios
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);
  return result.recordset[0].total > 0;
}

async function insertUsuario({ email, senhaHash, role }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .input('senhaHash', sql.NVarChar, senhaHash)
    .input('role', sql.VarChar, role)
    .query(`
      INSERT INTO Usuarios (email, senha_hash, is_admin, role, criado_em)
      OUTPUT inserted.id, inserted.email, inserted.is_admin AS isAdmin, inserted.role, inserted.criado_em
      VALUES (@email, @senhaHash, 0, @role, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}

async function deleteById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('DELETE FROM Usuarios WHERE id = @id');
  return result.rowsAffected[0];
}

module.exports = {
  findByEmailForLogin,
  findByEmail,
  findById,
  listAll,
  existeEmail,
  insertUsuario,
  deleteById,
};
