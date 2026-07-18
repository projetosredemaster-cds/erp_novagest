const express = require('express');
const usuarioController = require('../controllers/usuario.controller');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

const router = express.Router();

// Todas as rotas de /api/admin/* exigem authMiddleware + adminMiddleware,
// nessa ordem.
router.use(authMiddleware, adminMiddleware);

// GET    /api/admin/usuarios
router.get('/usuarios', usuarioController.listarUsuarios);

// POST   /api/admin/usuarios
router.post('/usuarios', usuarioController.criarUsuario);

// DELETE /api/admin/usuarios/:id
router.delete('/usuarios/:id', usuarioController.excluirUsuario);

module.exports = router;
