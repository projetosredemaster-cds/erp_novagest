const express = require('express');
const margensController = require('../controllers/margens.controller');

const router = express.Router();

// GET  /api/margens/entradas?data=YYYY-MM-DD
router.get('/entradas', margensController.listarEntradas);

// POST /api/margens/entradas  (upsert por data + lojaId)
router.post('/entradas', margensController.criarOuAtualizarEntrada);

// GET  /api/margens/relatorio?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD
router.get('/relatorio', margensController.gerarRelatorio);

module.exports = router;
