const express = require('express');
const marketingController = require('../controllers/marketing.controller');

const router = express.Router();

router.get('/entradas', marketingController.listarEntradas);

router.post('/entradas', marketingController.criarOuAtualizarEntrada);

router.delete('/entradas', marketingController.excluirEntrada);

module.exports = router;
