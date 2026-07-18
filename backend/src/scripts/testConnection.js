require('dotenv').config();
const { sql, getPool } = require('../config/db');

/**
 * Script utilitário para testar a conexão com o Azure SQL Database
 * usando as credenciais definidas em backend/.env.
 *
 * Uso: npm run test:db  (a partir da pasta backend/)
 */
async function testConnection() {
  console.log('[testConnection] Tentando conectar ao Azure SQL Database...');
  console.log(`[testConnection] Servidor: ${process.env.DB_SERVER || '(não definido)'}`);
  console.log(`[testConnection] Banco: ${process.env.DB_DATABASE || '(não definido)'}`);

  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 AS ok');
    console.log('[testConnection] SUCESSO! Conexão estabelecida e query de teste executada.');
    console.log('[testConnection] Resultado:', result.recordset);
    process.exitCode = 0;
  } catch (err) {
    console.error('[testConnection] FALHA ao conectar no banco de dados.');
    console.error('[testConnection] Mensagem de erro:', err.message);
    process.exitCode = 1;
  } finally {
    try {
      await sql.close();
    } catch (_) {
      // ignora erro ao fechar pool que pode nem ter sido aberta
    }
  }
}

testConnection();
