const express = require('express');
const multer = require('multer');

const estadosController = require('../controllers/estados.controller');
const numerosRemetentesController = require('../controllers/numerosRemetentes.controller');
const importacaoController = require('../controllers/importacao.controller');
const disparosController = require('../controllers/disparos.controller');

const router = express.Router();

// Express gera ETag automaticamente pra toda resposta JSON (default global do
// app, `app.set('etag', 'weak')`, não sobrescrito em app.js). Isso faz o
// Express responder `304 Not Modified` (corpo vazio) sempre que o cliente
// manda de volta um `If-None-Match` que bate com o ETag da resposta anterior
// — inadequado aqui, porque as rotas deste módulo servem dado
// dinâmico/autenticado (estados, números remetentes, contatos, disparos) que
// não deve ser cacheado pelo cliente.
//
// `express.Router()` não tem um equivalente a `app.set('etag', false)` — a
// configuração 'etag' só existe no objeto `app` (ver express/lib/application.js),
// Router não implementa `.set()`/`.get()` de settings. Por isso a correção é
// feita aqui, via middleware, só para o sub-router deste módulo (sem alterar
// nada global em app.js):
//   1. `Cache-Control: no-store` instrui o cliente a nunca guardar a resposta
//      em cache nem reenviar `If-None-Match` em requests futuros.
//   2. Como defesa extra (cobre clientes que ignorem o Cache-Control, ou que já
//      tenham um ETag em cache de antes desse fix), removemos os headers
//      condicionais (`If-None-Match`/`If-Modified-Since`) da própria request
//      antes dela chegar no controller — sem eles, a checagem de "freshness"
//      do Express (`req.fresh`, usada dentro de `res.json`/`res.send`) nunca
//      encontra nada pra comparar e o Express nunca decide por um 304 aqui.
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

// '/historico' precisa vir antes de '/:loteId' (mesmo verbo GET) — senão o
// Express casaria "historico" com o parâmetro :loteId da rota de detalhe.
router.get('/contatos/importar/historico', importacaoController.historico);
router.post('/contatos/importar', upload.single('arquivo'), importacaoController.importar);
// Descontinuada em v3 — sempre responde 410 (ver importacao.controller.js).
router.post('/contatos/importar/:loteId/confirmar', importacaoController.confirmar);
router.get('/contatos/importar/:loteId', importacaoController.detalhe);

router.get('/painel-disparo', disparosController.painelDisparo);
router.get('/estados/:estadoId/contatos-disponiveis', disparosController.contatosDisponiveis);
router.post('/disparos', disparosController.criar);

module.exports = router;
