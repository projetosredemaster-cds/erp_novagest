const express = require('express');
const marketingController = require('../controllers/marketing.controller');

const router = express.Router();

// GET  /api/marketing/entradas?ano=YYYY&mes=MM
router.get('/entradas', marketingController.listarEntradas);

// POST /api/marketing/entradas  (upsert por ano + mes + lojaId)
router.post('/entradas', marketingController.criarOuAtualizarEntrada);

// DELETE /api/marketing/entradas?ano=YYYY&mes=MM&lojaId=X  (idempotente)
router.delete('/entradas', marketingController.excluirEntrada);

module.exports = router;
