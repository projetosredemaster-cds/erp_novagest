const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const usuarioModel = require('../models/usuario.model');

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
