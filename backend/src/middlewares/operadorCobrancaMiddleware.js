
function operadorCobrancaMiddleware(req, res, next) {
  if (!req.usuario || req.usuario.role !== 'operador_cobranca') {
    return res.status(403).json({ error: 'Acesso restrito ao Controle de Ligações.' });
  }

  return next();
}

module.exports = operadorCobrancaMiddleware;
