const express = require('express');
const cadastrosController = require('../controllers/cadastros.controller');
const adminMiddleware = require('../middlewares/adminMiddleware');

const router = express.Router();

// GET  /api/cadastros/diretores  (diretores com redes aninhadas)
router.get('/diretores', cadastrosController.listarDiretores);

// POST /api/cadastros/diretores
router.post('/diretores', cadastrosController.criarDiretor);

// PUT  /api/cadastros/diretores/:id
router.put('/diretores/:id', cadastrosController.atualizarDiretor);

// DELETE /api/cadastros/diretores/:id  (bloqueia com 409 se houver redes vinculadas)
router.delete('/diretores/:id', cadastrosController.excluirDiretor);

// GET  /api/cadastros/redes  (redes visíveis com diretor + responsável + lojas[] aninhadas)
router.get('/redes', cadastrosController.listarRedes);

// POST /api/cadastros/redes
router.post('/redes', cadastrosController.criarRede);

// PUT  /api/cadastros/redes/:id  (usado também para soft-delete via ativo=false, e para ocultar via visivel=false)
router.put('/redes/:id', cadastrosController.atualizarRede);

// DELETE /api/cadastros/redes/:id  (bloqueia com 409 se houver entradas vinculadas)
router.delete('/redes/:id', cadastrosController.excluirRede);

// POST /api/cadastros/lojas
router.post('/lojas', cadastrosController.criarLoja);

// PUT  /api/cadastros/lojas/:id  (usado também para soft-delete via ativo=false; sem rota DELETE — loja nunca é excluída)
router.put('/lojas/:id', cadastrosController.atualizarLoja);

// GET  /api/cadastros/responsaveis  (qualquer usuário autenticado)
router.get('/responsaveis', cadastrosController.listarResponsaveis);

// POST /api/cadastros/responsaveis  (restrito a admin)
router.post('/responsaveis', adminMiddleware, cadastrosController.criarResponsavel);

// DELETE /api/cadastros/responsaveis/:id  (restrito a admin; bloqueia com 409 se houver redes vinculadas)
router.delete('/responsaveis/:id', adminMiddleware, cadastrosController.excluirResponsavel);

module.exports = router;
