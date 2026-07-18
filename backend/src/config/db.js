require('dotenv').config();
const sql = require('mssql');

/**
 * Configuração de conexão com o Azure SQL Database, compartilhado por
 * todos os módulos do ERP (ex: Ranking).
 *
 * Todas as credenciais vêm de variáveis de ambiente (.env) — nunca hardcode
 * valores aqui. Veja backend/.env.example para a lista de variáveis esperadas.
 */
const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    // Azure SQL exige encrypt=true. trustServerCertificate deve ficar false
    // em produção (só usar true para debug local com certificado autoassinado).
    encrypt: process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 15000,
  requestTimeout: 15000,
};

const REQUIRED_ENV_VARS = ['DB_SERVER', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'];

let poolPromise = null;

/**
 * Retorna uma Promise resolvida com um pool de conexão reutilizável.
 * Reaproveita a mesma pool entre chamadas; se a conexão falhar, permite
 * que a próxima chamada tente novamente (não fica "travado" com erro).
 */
function getPool() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return Promise.reject(
      new Error(`Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}`)
    );
  }

  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(dbConfig)
      .connect()
      .then((pool) => {
        console.log('[db] Conectado ao Azure SQL Database com sucesso.');
        pool.on('error', (err) => {
          console.error('[db] Erro no pool de conexão:', err);
        });
        return pool;
      })
      .catch((err) => {
        poolPromise = null; // permite nova tentativa na próxima chamada
        throw err;
      });
  }

  return poolPromise;
}

module.exports = { sql, getPool };
