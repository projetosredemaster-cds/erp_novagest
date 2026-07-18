const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usuarioModel = require('../models/usuario.model');

/**
 * Camada de regra de negócio de autenticação. Não conhece Express
 * (req/res) — recebe/retorna dados já validados pelo controller.
 */

/**
 * Autentica um usuário por e-mail/senha.
 * Retorna `null` se o e-mail não existir OU a senha não conferir (o
 * controller trata os dois casos com a mesma mensagem/status, para nunca
 * revelar qual dos dois estava errado).
 * Em caso de sucesso, retorna `{ token, usuario: { id, email, isAdmin } }`.
 */
async function login({ email, senha }) {
  const usuario = await usuarioModel.findByEmailForLogin(email);
  if (!usuario) {
    return null;
  }

  const senhaValida = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaValida) {
    return null;
  }

  const payload = {
    id: usuario.id,
    email: usuario.email,
    isAdmin: usuario.isAdmin === true,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });

  return { token, usuario: payload };
}

module.exports = {
  login,
};
