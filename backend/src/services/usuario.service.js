const bcrypt = require('bcrypt');
const usuarioModel = require('../models/usuario.model');

/**
 * Camada de regra de negócio de administração de usuários. Não conhece
 * Express (req/res) — recebe/retorna dados já validados pelo controller.
 */

async function listarUsuarios() {
  return usuarioModel.listAll();
}

/**
 * Cria um novo usuário comum (nunca admin — não existe forma de criar um
 * admin por esta rota).
 * Retorna 'email_duplicado' se já existir um usuário com o mesmo e-mail
 * (case-insensitive, ignorando espaços extras), senão o usuário criado.
 */
async function criarUsuario({ email, senha }) {
  const duplicado = await usuarioModel.existeEmail(email);
  if (duplicado) {
    return 'email_duplicado';
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  return usuarioModel.insertUsuario({ email, senhaHash });
}

/**
 * Exclui um usuário, bloqueando a auto-exclusão (o próprio usuário
 * autenticado tentando se excluir).
 * Retorna 'not_found' | 'self_delete' | 'deleted'.
 */
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
