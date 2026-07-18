const jwt = require('jsonwebtoken');

/**
 * Middleware de autenticação. Lê o header `Authorization: Bearer <token>`,
 * valida o token JWT com `process.env.JWT_SECRET` e, se válido, popula
 * `req.usuario = { id, email, isAdmin }` a partir do payload decodificado.
 *
 * Ver seção "authMiddleware" de CONTRATO-AUTH-API.md para as mensagens de
 * erro exatas.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticação não informado.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação não informado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = {
      id: payload.id,
      email: payload.email,
      isAdmin: payload.isAdmin,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token de autenticação inválido ou expirado.' });
  }
}

module.exports = authMiddleware;
