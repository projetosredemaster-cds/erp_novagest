const bcrypt = require('bcrypt');
const usuarioModel = require('../models/usuario.model');


async function listarUsuarios() {
  return usuarioModel.listAll();
}

async function criarUsuario({ email, senha, operadorCobranca }) {
  const duplicado = await usuarioModel.existeEmail(email);
  if (duplicado) {
    return 'email_duplicado';
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const role = operadorCobranca === true ? 'operador_cobranca' : 'usuario';
  return usuarioModel.insertUsuario({ email, senhaHash, role });
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
