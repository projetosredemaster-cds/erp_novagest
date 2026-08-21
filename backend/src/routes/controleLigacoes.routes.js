const express = require('express');
const multer = require('multer');

const estadosController = require('../controllers/estados.controller');
const numerosRemetentesController = require('../controllers/numerosRemetentes.controller');
const importacaoController = require('../controllers/importacao.controller');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/estados', estadosController.listar);
router.post('/estados', estadosController.criar);

router.get('/numeros-remetentes', numerosRemetentesController.listar);
router.post('/numeros-remetentes', numerosRemetentesController.criar);
router.put('/numeros-remetentes/:id', numerosRemetentesController.atualizar);
router.delete('/numeros-remetentes/:id', numerosRemetentesController.excluir);

router.get('/contatos/importar/pendentes', importacaoController.listarPendentes);
router.post('/contatos/importar', upload.single('arquivo'), importacaoController.importar);
router.post('/contatos/importar/:loteId/confirmar', importacaoController.confirmar);

module.exports = router;
