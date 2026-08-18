const express = require('express');
const cadastrosController = require('../controllers/cadastros.controller');
const adminMiddleware = require('../middlewares/adminMiddleware');

const router = express.Router();

router.get('/diretores', cadastrosController.listarDiretores);

router.post('/diretores', cadastrosController.criarDiretor);

router.put('/diretores/:id', cadastrosController.atualizarDiretor);

router.delete('/diretores/:id', cadastrosController.excluirDiretor);

router.get('/redes', cadastrosController.listarRedes);

router.post('/redes', cadastrosController.criarRede);

router.put('/redes/:id', cadastrosController.atualizarRede);

router.delete('/redes/:id', cadastrosController.excluirRede);

router.post('/lojas', cadastrosController.criarLoja);

router.put('/lojas/:id', cadastrosController.atualizarLoja);

router.get('/responsaveis', cadastrosController.listarResponsaveis);

router.post('/responsaveis', adminMiddleware, cadastrosController.criarResponsavel);

router.delete('/responsaveis/:id', adminMiddleware, cadastrosController.excluirResponsavel);

module.exports = router;
