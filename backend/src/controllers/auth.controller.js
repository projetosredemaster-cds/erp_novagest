const authService = require('../services/auth.service');
const { senhaAtendeComplexidade, MENSAGEM_SENHA_FRACA } = require('../utils/senhaValidator');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validarCredenciaisBody(body) {
  const { email, senha } = body;

  if (!isNonEmptyString(email)) {
    return 'Campo "email" é obrigatório.';
  }

  if (!isNonEmptyString(senha)) {
    return 'Campo "senha" é obrigatório.';
  }

  return null;
}

async function login(req, res) {
  const body = req.body || {};
  const { email, senha } = body;

  const erroValidacao = validarCredenciaisBody(body);
  if (erroValidacao) {
    return res.status(400).json({ error: erroValidacao });
  }

  try {
    const resultado = await authService.login({ email, senha });

    if (resultado === null) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    if (resultado === 'role_incompativel') {
      return res.status(403).json({
        error: 'Este usuário deve acessar pelo login do Controle de Ligações.',
      });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[auth.controller] Erro ao autenticar:', err);
    return res.status(500).json({ error: 'Erro interno ao autenticar.' });
  }
}

async function loginReativacao(req, res) {
  const body = req.body || {};
  const { email, senha } = body;

  const erroValidacao = validarCredenciaisBody(body);
  if (erroValidacao) {
    return res.status(400).json({ error: erroValidacao });
  }

  try {
    const resultado = await authService.loginReativacao({ email, senha });

    if (resultado === null) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }

    if (resultado === 'role_incompativel') {
      return res.status(403).json({
        error: 'Este usuário não tem acesso ao Controle de Ligações.',
      });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[auth.controller] Erro ao autenticar (reativação):', err);
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

async function esqueciSenha(req, res) {
  const body = req.body || {};
  const { email } = body;

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'Campo "email" é obrigatório.' });
  }

  try {
    await authService.esqueciSenha({ email });
    return res.status(200).json({
      message: 'Se o e-mail informado estiver cadastrado, você receberá um link de recuperação em instantes.',
    });
  } catch (err) {
    console.error('[auth.controller] Erro ao processar solicitação de recuperação de senha:', err);
    return res.status(500).json({ error: 'Erro interno ao processar solicitação.' });
  }
}

async function redefinirSenha(req, res) {
  const body = req.body || {};
  const { token, novaSenha } = body;

  if (!isNonEmptyString(token)) {
    return res.status(400).json({ error: 'Campo "token" é obrigatório.' });
  }

  if (!isNonEmptyString(novaSenha)) {
    return res.status(400).json({ error: 'Campo "novaSenha" é obrigatório.' });
  }

  if (!senhaAtendeComplexidade(novaSenha)) {
    return res.status(400).json({ error: MENSAGEM_SENHA_FRACA });
  }

  try {
    const resultado = await authService.redefinirSenha({ token, novaSenha });

    if (resultado === 'token_invalido') {
      return res.status(400).json({ error: 'Link de recuperação inválido ou expirado.' });
    }

    return res.status(200).json({ message: 'Senha redefinida com sucesso.' });
  } catch (err) {
    console.error('[auth.controller] Erro ao redefinir senha:', err);
    return res.status(500).json({ error: 'Erro interno ao redefinir senha.' });
  }
}

module.exports = {
  login,
  loginReativacao,
  me,
  esqueciSenha,
  redefinirSenha,
};
