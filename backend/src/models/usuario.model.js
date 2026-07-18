const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo de autenticação/admin.
 *
 * Schema (já existe no banco — não recriar):
 *   Usuarios (id, email, senha_hash, is_admin, criado_em)
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 *
 * As colunas `is_admin`/`senha_hash` são aliasadas para `isAdmin`/
 * `senhaHash` diretamente no SQL, para que services/controllers já
 * recebam o shape camelCase esperado pelas respostas da API (ver
 * CONTRATO-AUTH-API.md). `senha_hash`/`senhaHash` NUNCA deve ser incluído
 * em nenhuma resposta HTTP — só é usado internamente pelo auth.service
 * para comparar com bcrypt.
 */

/**
 * Busca um usuário pelo e-mail (case-insensitive, ignorando espaços extras
 * no início/fim), incluindo o `senhaHash` — uso exclusivo do login.
 * Retorna `undefined` se não existir.
 */
async function findByEmailForLogin(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT id, email, senha_hash AS senhaHash, is_admin AS isAdmin
      FROM Usuarios
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);
  return result.recordset[0];
}

/**
 * Busca um usuário por id, sem `senha_hash`. Retorna `undefined` se não existir.
 */
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

/**
 * Lista todos os usuários, sem `senha_hash`, ordenados por e-mail.
 */
async function listAll() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, email, is_admin AS isAdmin, criado_em
    FROM Usuarios
    ORDER BY email
  `);
  return result.recordset;
}

/**
 * Verifica se já existe um usuário com o mesmo `email` (case-insensitive,
 * ignorando espaços extras no início/fim).
 */
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

/**
 * Insere um novo usuário comum (sempre `is_admin = 0`) e retorna o
 * registro criado, sem `senha_hash`.
 */
async function insertUsuario({ email, senhaHash }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .input('senhaHash', sql.NVarChar, senhaHash)
    .query(`
      INSERT INTO Usuarios (email, senha_hash, is_admin, criado_em)
      OUTPUT inserted.id, inserted.email, inserted.is_admin AS isAdmin, inserted.criado_em
      VALUES (@email, @senhaHash, 0, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}

/**
 * Exclui um usuário por id (exclusão física). Retorna o número de linhas
 * afetadas (0 se o id não existir).
 */
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
  findById,
  listAll,
  existeEmail,
  insertUsuario,
  deleteById,
};
