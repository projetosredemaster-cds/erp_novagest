const express = require('express');
const rankingController = require('../controllers/ranking.controller');

const router = express.Router();

// GET  /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X
router.get('/entradas', rankingController.listarEntradas);

// POST /api/ranking/entradas  (upsert por data + categoriaId + lojaId)
router.post('/entradas', rankingController.criarOuAtualizarEntrada);

// GET  /api/ranking/redes  (redes com lojas aninhadas)
router.get('/redes', rankingController.listarRedes);

// POST /api/ranking/redes
router.post('/redes', rankingController.criarRede);

// PUT  /api/ranking/redes/:id
router.put('/redes/:id', rankingController.atualizarRede);

// DELETE /api/ranking/redes/:id  (bloqueia com 409 se houver lojas vinculadas)
router.delete('/redes/:id', rankingController.excluirRede);

// POST /api/ranking/lojas
router.post('/lojas', rankingController.criarLoja);

// PUT  /api/ranking/lojas/:id  (usado também para soft-delete via ativo=false)
router.put('/lojas/:id', rankingController.atualizarLoja);

// DELETE /api/ranking/lojas/:id  (bloqueia com 409 se houver entradas vinculadas)
router.delete('/lojas/:id', rankingController.excluirLoja);

// GET  /api/ranking/categorias
router.get('/categorias', rankingController.listarCategorias);

// POST /api/ranking/relatorio/email  (envia o texto do relatório do dia por e-mail via Brevo)
router.post('/relatorio/email', rankingController.enviarRelatorioEmail);

module.exports = router;
