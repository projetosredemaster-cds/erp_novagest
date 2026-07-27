const express = require('express');
const rankingController = require('../controllers/ranking.controller');
const adminMiddleware = require('../middlewares/adminMiddleware');

const router = express.Router();

// GET  /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X
router.get('/entradas', rankingController.listarEntradas);

// POST /api/ranking/entradas  (upsert por data + categoriaId + redeId)
router.post('/entradas', rankingController.criarOuAtualizarEntrada);

// GET  /api/ranking/diretores  (diretores com redes aninhadas)
router.get('/diretores', rankingController.listarDiretores);

// POST /api/ranking/diretores
router.post('/diretores', rankingController.criarDiretor);

// PUT  /api/ranking/diretores/:id
router.put('/diretores/:id', rankingController.atualizarDiretor);

// DELETE /api/ranking/diretores/:id  (bloqueia com 409 se houver redes vinculadas)
router.delete('/diretores/:id', rankingController.excluirDiretor);

// POST /api/ranking/redes
router.post('/redes', rankingController.criarRede);

// PUT  /api/ranking/redes/:id  (usado também para soft-delete via ativo=false, e para ocultar via visivel=false)
router.put('/redes/:id', rankingController.atualizarRede);

// DELETE /api/ranking/redes/:id  (bloqueia com 409 se houver entradas vinculadas)
router.delete('/redes/:id', rankingController.excluirRede);

// GET  /api/ranking/categorias
router.get('/categorias', rankingController.listarCategorias);

// POST /api/ranking/relatorio/email  (envia o texto do relatório do dia por e-mail via Brevo)
router.post('/relatorio/email', rankingController.enviarRelatorioEmail);

// GET  /api/ranking/responsaveis  (qualquer usuário autenticado)
router.get('/responsaveis', rankingController.listarResponsaveis);

// POST /api/ranking/responsaveis  (restrito a admin)
router.post('/responsaveis', adminMiddleware, rankingController.criarResponsavel);

// DELETE /api/ranking/responsaveis/:id  (restrito a admin; bloqueia com 409 se houver redes vinculadas)
router.delete('/responsaveis/:id', adminMiddleware, rankingController.excluirResponsavel);

module.exports = router;
