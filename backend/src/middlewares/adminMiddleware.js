
function adminMiddleware(req, res, next) {
  if (!req.usuario || req.usuario.isAdmin !== true) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  return next();
}

module.exports = adminMiddleware;
