const express = require('express');
const usuarioController = require('../controllers/usuario.controller');
const authMiddleware = require('../middlewares/authMiddleware');
const adminMiddleware = require('../middlewares/adminMiddleware');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);

router.get('/usuarios', usuarioController.listarUsuarios);

router.post('/usuarios', usuarioController.criarUsuario);

router.delete('/usuarios/:id', usuarioController.excluirUsuario);

module.exports = router;
