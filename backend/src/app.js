const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const rankingRoutes = require('./routes/ranking.routes');
const cadastrosRoutes = require('./routes/cadastros.routes');
const margensRoutes = require('./routes/margens.routes');
const marketingRoutes = require('./routes/marketing.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const authMiddleware = require('./middlewares/authMiddleware');

const app = express();

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.FRONTEND_URL].filter(Boolean)
  : [process.env.FRONTEND_URL, 'http://localhost:5173'].filter(Boolean);

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

if (process.env.NODE_ENV !== 'development') {
  app.use('/api/auth/login', loginLimiter);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/ranking', authMiddleware, rankingRoutes);

app.use('/api/cadastros', authMiddleware, cadastrosRoutes);

app.use('/api/margens', authMiddleware, margensRoutes);

app.use('/api/marketing', authMiddleware, marketingRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((err, req, res, next) => {
  console.error('[app] Erro não tratado:', err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

module.exports = app;
