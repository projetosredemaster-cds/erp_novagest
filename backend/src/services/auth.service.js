const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const usuarioModel = require('../models/usuario.model');
const passwordResetModel = require('../models/passwordReset.model');
const brevoEmailService = require('./brevoEmail.service');

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

async function autenticarCredenciais({ email, senha }) {
  const usuario = await usuarioModel.findByEmailForLogin(email);
  if (!usuario) {
    return null;
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaValida) {
    return null;
  }

  return usuario;
}

function gerarSessao(usuario) {
  const payload = {
    id: usuario.id,
    email: usuario.email,
    isAdmin: usuario.isAdmin === true,
    role: usuario.role,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

  return { token, usuario: payload };
}

async function login({ email, senha }) {
  const usuario = await autenticarCredenciais({ email, senha });
  if (!usuario) {
    return null;
  }

  if (usuario.role === 'operador_cobranca') {
    return 'role_incompativel';
  }

  return gerarSessao(usuario);
}

async function loginReativacao({ email, senha }) {
  const usuario = await autenticarCredenciais({ email, senha });
  if (!usuario) {
    return null;
  }

  if (usuario.role !== 'operador_cobranca') {
    return 'role_incompativel';
  }

  return gerarSessao(usuario);
}

async function esqueciSenha({ email }) {
  const usuario = await usuarioModel.findByEmail(email);
  if (!usuario) {
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiraEm = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await passwordResetModel.insertToken({
    usuarioId: usuario.id,
    tokenHash,
    expiraEm,
  });

  const link = `${process.env.FRONTEND_URL}/redefinir-senha?token=${token}`;

  await brevoEmailService.enviarEmailRecuperacaoSenha({
    destinatario: usuario.email,
    link,
  });
}

async function redefinirSenha({ token, novaSenha }) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const registro = await passwordResetModel.findByTokenHash(tokenHash);

  const tokenValido =
    registro && registro.usado !== true && new Date(registro.expiraEm).getTime() >= Date.now();

  if (!tokenValido) {
    return 'token_invalido';
  }

  const senhaHash = await bcrypt.hash(novaSenha, 10);
  await passwordResetModel.redefinirSenha({
    tokenId: registro.id,
    usuarioId: registro.usuarioId,
    senhaHash,
  });

  return 'ok';
}

module.exports = {
  login,
  loginReativacao,
  esqueciSenha,
  redefinirSenha,
};
