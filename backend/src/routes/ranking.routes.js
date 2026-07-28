const express = require('express');
const rankingController = require('../controllers/ranking.controller');

const router = express.Router();

// GET  /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X
router.get('/entradas', rankingController.listarEntradas);

// POST /api/ranking/entradas  (upsert por data + categoriaId + redeId)
router.post('/entradas', rankingController.criarOuAtualizarEntrada);

// DELETE /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X&redeId=Y  (idempotente, sempre 204)
router.delete('/entradas', rankingController.excluirEntrada);

// GET  /api/ranking/categorias  (retorna todas, inclusive visivel=false)
router.get('/categorias', rankingController.listarCategorias);

// POST /api/ranking/categorias  (cria com padrao=false, principal=false, visivel=true)
router.post('/categorias', rankingController.criarCategoria);

// PUT  /api/ranking/categorias/:id  (só nome/visivel — nunca padrao/principal)
router.put('/categorias/:id', rankingController.atualizarCategoria);

// DELETE /api/ranking/categorias/:id  (409 se padrao=true, 409 se tem lançamentos)
router.delete('/categorias/:id', rankingController.excluirCategoria);

// POST /api/ranking/relatorio/email  (envia o texto do relatório do dia por e-mail via Brevo)
router.post('/relatorio/email', rankingController.enviarRelatorioEmail);

module.exports = router;
