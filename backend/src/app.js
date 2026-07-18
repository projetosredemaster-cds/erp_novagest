const express = require('express');
const cors = require('cors');

const rankingRoutes = require('./routes/ranking.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const authMiddleware = require('./middlewares/authMiddleware');

const app = express();

app.use(cors());
app.use(express.json());

// Rota simples de healthcheck da API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Rotas de autenticação (login público, /me protegida por authMiddleware
// dentro do próprio router) e de administração de usuários (todas
// protegidas por authMiddleware + adminMiddleware dentro do router).
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Rotas do módulo Ranking. Futuros módulos do erp_Novagest devem ser
// montados aqui seguindo o mesmo padrão: app.use('/api/<modulo>', rotas).
// Protegidas por authMiddleware — qualquer usuário autenticado (admin ou
// não) pode usá-las; ver CONTRATO-AUTH-API.md, seção "Rotas protegidas do
// resto do sistema".
app.use('/api/ranking', authMiddleware, rankingRoutes);

// 404 — rota não encontrada
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// Middleware de tratamento de erro genérico (fallback de segurança;
// os controllers já tratam seus próprios erros, mas isso evita que
// qualquer exceção não tratada quebre o processo ou vaze stack trace).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[app] Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

module.exports = app;
