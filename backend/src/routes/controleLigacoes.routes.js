const express = require('express');
const multer = require('multer');

const estadosController = require('../controllers/estados.controller');
const numerosRemetentesController = require('../controllers/numerosRemetentes.controller');
const importacaoController = require('../controllers/importacao.controller');
const disparosController = require('../controllers/disparos.controller');
const conversasController = require('../controllers/conversas.controller');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
  next();
});

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
router.get('/numeros-remetentes/:id/conexao/stream', numerosRemetentesController.conexaoStream);
router.post('/numeros-remetentes/:id/conexao/desconectar', numerosRemetentesController.conexaoDesconectar);

router.get('/contatos/importar/historico', importacaoController.historico);
router.post('/contatos/importar', upload.single('arquivo'), importacaoController.importar);
router.post('/contatos/importar/:loteId/confirmar', importacaoController.confirmar);
router.get('/contatos/importar/:loteId', importacaoController.detalhe);

router.get('/painel-disparo', disparosController.painelDisparo);
router.get('/estados/:estadoId/contatos-disponiveis', disparosController.contatosDisponiveis);
router.post('/disparos/verificar', disparosController.verificar);
router.post('/disparos', disparosController.criar);
router.get('/disparos/:id', disparosController.detalhe);

router.get('/conversas', conversasController.listar);
router.get('/conversas/stream', conversasController.stream);
router.get('/conversas/:contatoId/:numeroRemetenteId/mensagens', conversasController.mensagens);
router.post('/conversas/:contatoId/:numeroRemetenteId/mensagens', conversasController.responder);
router.get('/notificacoes', conversasController.notificacoes);

module.exports = router;
