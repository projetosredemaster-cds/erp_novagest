const bcrypt = require('bcrypt');
const usuarioModel = require('../models/usuario.model');


async function listarUsuarios() {
  return usuarioModel.listAll();
}

async function criarUsuario({ email, senha }) {
  const duplicado = await usuarioModel.existeEmail(email);
  if (duplicado) {
    return 'email_duplicado';
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  return usuarioModel.insertUsuario({ email, senhaHash });
}

async function excluirUsuario(id, usuarioAutenticadoId) {
  const existente = await usuarioModel.findById(id);
  if (!existente) {
    return 'not_found';
  }

  if (id === usuarioAutenticadoId) {
    return 'self_delete';
  }

  await usuarioModel.deleteById(id);
  return 'deleted';
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  excluirUsuario,
};
