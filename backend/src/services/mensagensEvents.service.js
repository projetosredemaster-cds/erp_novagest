const { EventEmitter } = require('events');

/**
 * Canal de eventos em memória usado para sinalizar "chegou mensagem nova" em
 * tempo real, na Central de Mensagens (ver CONTRATO-CONTROLE-LIGACOES-API.md,
 * seção "Central de Mensagens (v7)"). É um único `EventEmitter` compartilhado
 * por todo o processo (não 1 por número remetente/contato) — broadcast
 * simples via o módulo nativo `events`.
 *
 * Produtor: `baileysSession.service.js: handleMessagesUpsert`, que emite
 * `'mensagem-recebida'` (payload `{ contatoId, numeroRemetenteId }`) sempre
 * que uma mensagem de cliente é efetivamente gravada em `Mensagens` — nunca
 * quando a gravação é ignorada por dedup de evento duplicado do Baileys (ver
 * `mensagens.model.js: inserirMensagemRecebida`, que retorna `null` nesse
 * caso).
 *
 * Consumidor: `conversas.controller.js: stream` (GET /conversas/stream, SSE),
 * que escuta `'mensagem-recebida'` e repassa o payload para todo cliente
 * conectado no momento — não guarda histórico de eventos, um cliente que
 * conecta depois de um evento emitido simplesmente não o recebe (a tela
 * consumidora deve fazer um fetch inicial normal, este canal é só push
 * incremental).
 */
module.exports = new EventEmitter();
