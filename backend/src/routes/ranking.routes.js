const express = require('express');
const rankingController = require('../controllers/ranking.controller');

const router = express.Router();

router.get('/entradas', rankingController.listarEntradas);

router.post('/entradas', rankingController.criarOuAtualizarEntrada);

router.delete('/entradas', rankingController.excluirEntrada);

router.get('/categorias', rankingController.listarCategorias);

router.post('/categorias', rankingController.criarCategoria);

router.put('/categorias/:id', rankingController.atualizarCategoria);

router.delete('/categorias/:id', rankingController.excluirCategoria);

router.post('/relatorio/email', rankingController.enviarRelatorioEmail);

module.exports = router;
