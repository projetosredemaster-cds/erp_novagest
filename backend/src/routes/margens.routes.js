const express = require('express');
const margensController = require('../controllers/margens.controller');

const router = express.Router();

router.get('/entradas', margensController.listarEntradas);

router.post('/entradas', margensController.criarOuAtualizarEntrada);

router.get('/relatorio', margensController.gerarRelatorio);

module.exports = router;
