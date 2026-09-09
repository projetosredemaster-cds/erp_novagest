const disparosModel = require('../models/disparos.model');
const disparosEventsService = require('./disparosEvents.service');
// Import só pra reaproveitar processarItemUnico no reenvio manual — sem ciclo:
// envioDisparos.worker.js não importa disparos.service.js (só model,
// mensagensTemplatesModel, numerosRemetentesModel, mensagensModel,
// baileysSessionService e disparosEventsService).
const envioDisparosWorker = require('../workers/envioDisparos.worker');

const ORDENS_VALIDAS = ['nome_asc', 'nome_desc', 'recentes'];

async function listarPainelDisparo() {
  return disparosModel.listPainelDisparo();
}

async function listarContatosDisponiveis(estadoId, { busca, ordem } = {}) {
  const ordemNormalizada = ORDENS_VALIDAS.includes(ordem) ? ordem : 'nome_asc';
  const buscaNormalizada =
    typeof busca === 'string' && busca.trim().length > 0 ? busca.trim() : undefined;

  return disparosModel.listContatosDisponiveis(estadoId, {
    busca: buscaNormalizada,
    ordem: ordemNormalizada,
  });
}

async function verificarDisparo({ estadoId, numeroRemetenteId, contatoIds }) {
  const contatoIdsUnicos = [...new Set(contatoIds)];

  return disparosModel.verificarDisparo({
    estadoId,
    numeroRemetenteId,
    contatoIds: contatoIdsUnicos,
  });
}

async function criarDisparo({
  estadoId,
  numeroRemetenteId,
  usuarioId,
  contatoIds,
  tipoMensagem,
  diaSemana,
  horaAgendamento,
}) {
  const contatoIdsUnicos = [...new Set(contatoIds)];

  const resultado = await disparosModel.criarDisparo({
    estadoId,
    numeroRemetenteId,
    usuarioId,
    contatoIds: contatoIdsUnicos,
    tipoMensagem,
    diaSemana,
    horaAgendamento,
  });

  if (resultado.status === 'criado') {
    disparosEventsService.emit('disparo-criado', { disparoId: resultado.disparoId });
  }

  return resultado;
}

async function detalharDisparo(id) {
  return disparosModel.findDisparoDetalhe(id);
}

async function listarFalhas() {
  return disparosModel.listContatosFalha();
}

// Reenvio manual pontual de um DisparoContatos em status='falha'. Não usa
// cicloEmAndamento (a trava do worker) de propósito: um ciclo normal (timer
// ou evento 'disparo-criado') só processa itens com status='pendente', e este
// fluxo só age sobre itens status='falha' — os dois caminhos nunca competem
// pela mesma linha ao mesmo tempo. A corrida que existe de verdade é entre
// duas chamadas simultâneas desta própria função para o MESMO
// disparoContatoId (ex.: duplo clique/duas abas) — coberta pelo UPDATE
// condicional (`AND status = 'falha'`) em reativarContatoParaReenvio, checado
// via rowsAffected, não por mutex em memória.
async function reenviarContatoFalha(disparoContatoId) {
  const atual = await disparosModel.findDisparoContatoById(disparoContatoId);
  if (!atual) {
    return { status: 'nao_encontrado' };
  }

  if (atual.status !== 'falha') {
    return { status: 'nao_falha' };
  }

  const reativado = await disparosModel.reativarContatoParaReenvio(disparoContatoId);
  if (!reativado) {
    // Outra requisição venceu a corrida entre o SELECT acima e este UPDATE.
    return { status: 'conflito' };
  }

  const item = await disparosModel.findItemParaProcessarPorId(disparoContatoId);
  if (!item) {
    // Cenário extremamente improvável (a linha não é excluída em nenhum
    // ponto do sistema entre o UPDATE e esta releitura) — tratado por
    // completude, não porque haja um caminho conhecido que o produza.
    return { status: 'nao_encontrado' };
  }

  // processarItemUnico === processarItem do worker: nunca checa horário
  // comercial (só processarCicloEnvio checa, e não passamos por ele aqui) —
  // reenvio manual é ação humana pontual, processa imediatamente.
  await envioDisparosWorker.processarItemUnico(item);

  const resultado = await disparosModel.findResultadoReenvio(disparoContatoId);
  return { status: 'ok', contato: resultado };
}

// Ignora manualmente um DisparoContatos em status='falha' — só marca o
// timestamp ignorado_em (registro nunca é excluído). Diferente do reenvio,
// não há processamento posterior nenhum, é só o UPDATE condicional.
async function ignorarContatoFalha(disparoContatoId) {
  const atual = await disparosModel.findDisparoContatoById(disparoContatoId);
  if (!atual) {
    return { status: 'nao_encontrado' };
  }

  if (atual.status !== 'falha') {
    return { status: 'nao_falha' };
  }

  const ignorado = await disparosModel.ignorarContatoFalha(disparoContatoId);
  if (!ignorado) {
    // Outra requisição venceu a corrida entre o SELECT acima e este UPDATE.
    return { status: 'conflito' };
  }

  return { status: 'ok' };
}

module.exports = {
  listarPainelDisparo,
  listarContatosDisponiveis,
  verificarDisparo,
  criarDisparo,
  detalharDisparo,
  listarFalhas,
  reenviarContatoFalha,
  ignorarContatoFalha,
};
