/**
 * Middleware de autorização. Deve rodar sempre depois de `authMiddleware`,
 * que já populou `req.usuario`. Bloqueia com 403 qualquer usuário
 * autenticado que não seja admin.
 *
 * Ver seção "adminMiddleware" de CONTRATO-AUTH-API.md.
 */
function adminMiddleware(req, res, next) {
  if (!req.usuario || req.usuario.isAdmin !== true) {
    return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  }

  return next();
}

module.exports = adminMiddleware;
