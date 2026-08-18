const { sql, getPool } = require('../config/db');

async function insertToken({ usuarioId, tokenHash, expiraEm }) {
  const pool = await getPool();
  await pool
    .request()
    .input('usuarioId', sql.Int, usuarioId)
    .input('tokenHash', sql.VarChar(64), tokenHash)
    .input('expiraEm', sql.DateTime2, expiraEm)
    .query(`
      INSERT INTO PasswordResetTokens (usuario_id, token_hash, expira_em, usado, criado_em)
      VALUES (@usuarioId, @tokenHash, @expiraEm, 0, SYSUTCDATETIME())
    `);
}

async function findByTokenHash(tokenHash) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tokenHash', sql.VarChar(64), tokenHash)
    .query(`
      SELECT id, usuario_id AS usuarioId, expira_em AS expiraEm, usado
      FROM PasswordResetTokens
      WHERE token_hash = @tokenHash
    `);
  return result.recordset[0];
}

async function redefinirSenha({ tokenId, usuarioId, senhaHash }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const updateUsuarioRequest = new sql.Request(transaction);
    updateUsuarioRequest.input('usuarioId', sql.Int, usuarioId);
    updateUsuarioRequest.input('senhaHash', sql.NVarChar, senhaHash);
    await updateUsuarioRequest.query(`
      UPDATE Usuarios SET senha_hash = @senhaHash WHERE id = @usuarioId
    `);

    const usarTokenRequest = new sql.Request(transaction);
    usarTokenRequest.input('tokenId', sql.Int, tokenId);
    await usarTokenRequest.query(`
      UPDATE PasswordResetTokens SET usado = 1 WHERE id = @tokenId
    `);

    const invalidarOutrosRequest = new sql.Request(transaction);
    invalidarOutrosRequest.input('usuarioId', sql.Int, usuarioId);
    await invalidarOutrosRequest.query(`
      UPDATE PasswordResetTokens SET usado = 1 WHERE usuario_id = @usuarioId AND usado = 0
    `);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  insertToken,
  findByTokenHash,
  redefinirSenha,
};
