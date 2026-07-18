const usuarioService = require('../services/usuario.service');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * GET /api/admin/usuarios
 * Protegida por authMiddleware + adminMiddleware.
 */
async function listarUsuarios(req, res) {
  try {
    const usuarios = await usuarioService.listarUsuarios();
    return res.json(usuarios);
  } catch (err) {
    console.error('[usuario.controller] Erro ao listar usuários:', err);
    return res.status(500).json({ error: 'Erro interno ao listar usuários.' });
  }
}

/**
 * POST /api/admin/usuarios
 * Body: { email: string, senha: string }
 * Protegida por authMiddleware + adminMiddleware.
 */
async function criarUsuario(req, res) {
  const body = req.body || {};
  const { email, senha } = body;

  if (!isNonEmptyString(email)) {
    return res.status(400).json({ error: 'Campo "email" é obrigatório.' });
  }

  if (!isNonEmptyString(senha)) {
    return res.status(400).json({ error: 'Campo "senha" é obrigatório.' });
  }

  try {
    const resultado = await usuarioService.criarUsuario({ email, senha });

    if (resultado === 'email_duplicado') {
      return res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[usuario.controller] Erro ao criar usuário:', err);
    return res.status(500).json({ error: 'Erro interno ao criar usuário.' });
  }
}

/**
 * DELETE /api/admin/usuarios/:id
 * Protegida por authMiddleware + adminMiddleware.
 */
async function excluirUsuario(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await usuarioService.excluirUsuario(idNum, req.usuario.id);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (resultado === 'self_delete') {
      return res.status(409).json({
        error: 'Não é possível excluir seu próprio usuário enquanto estiver autenticado com ele.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[usuario.controller] Erro ao excluir usuário:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir usuário.' });
  }
}

module.exports = {
  listarUsuarios,
  criarUsuario,
  excluirUsuario,
};
