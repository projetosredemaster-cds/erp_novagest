const authService = require('../services/auth.service');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}


async function login(req, res) {
  const body = req.body || {};
  const { email, senha } = body;

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'Campo "email" é obrigatório.' });
  }

  if (!isNonEmptyString(senha)) {
    return res.status(400).json({ error: 'Campo "senha" é obrigatório.' });
  }

  try {
    const resultado = await authService.login({ email, senha });

    if (resultado === null) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[auth.controller] Erro ao autenticar:', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
}

async function me(req, res) {
  try {
    return res.status(200).json(req.usuario);
  } catch (err) {
    console.error('[auth.controller] Erro ao buscar usuário autenticado:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar usuário autenticado.' });
  }
}

module.exports = {
  login,
  me,
};
