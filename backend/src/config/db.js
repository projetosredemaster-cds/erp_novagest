require('dotenv').config();
const sql = require('mssql');


const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
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
        poolPromise = null;
        throw err;
      });
  }

  return poolPromise;
}

module.exports = { sql, getPool };
