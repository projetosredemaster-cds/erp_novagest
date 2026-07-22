// Roda ANTES de qualquer arquivo de teste ser importado — garante que
// `config/db.js` (que chama `dotenv.config()` na primeira vez que é
// importado, transitivamente via app.js/routes/controllers/services) nunca
// sobrescreva estas variáveis com valores do `.env` real (dotenv, por
// padrão, não sobrescreve variáveis já setadas em process.env).
// Isso impede qualquer teste de acidentalmente assinar/validar JWT com o
// JWT_SECRET real de produção.
process.env.JWT_SECRET = 'segredo-de-teste-vitest';
process.env.NODE_ENV = 'test';
