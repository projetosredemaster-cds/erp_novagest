const disparosModel = require('../models/disparos.model');
const mensagensTemplatesModel = require('../models/mensagensTemplates.model');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');
const disparosEventsService = require('../services/disparosEvents.service');

const INTERVALO_MS = Number(process.env.ENVIO_DISPAROS_INTERVALO_MS) || 300000;
const LOTE_TAMANHO = Number(process.env.ENVIO_DISPAROS_LOTE_TAMANHO) || 5;
const DELAY_ENTRE_MENSAGENS_MS = Number(process.env.ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS) || 4000;
const HORARIO_COMERCIAL_INICIO_HORA = Number(process.env.HORARIO_COMERCIAL_INICIO_HORA) || 11;
const HORARIO_COMERCIAL_FIM_HORA = Number(process.env.HORARIO_COMERCIAL_FIM_HORA) || 22;

let intervalHandle = null;
let cicloEmAndamento = false;

function estaDentroDoHorarioComercial(agora = new Date()) {
  const diaSemana = agora.getDay();
  if (diaSemana === 0 || diaSemana === 6) {
    return false;
  }

  const hora = agora.getHours();
  return hora >= HORARIO_COMERCIAL_INICIO_HORA && hora < HORARIO_COMERCIAL_FIM_HORA;
}

function aguardar(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mesma ressalva de HORARIO_COMERCIAL_*: usa o fuso horário LOCAL do processo Node
// (hoje UTC no servidor) — os limites de hora abaixo já vêm calibrados a partir do
// horário real de Brasília (UTC-3). Se o processo passar a rodar em outro fuso,
// recalcule os limites.
// Bug corrigido: os limites abaixo eram 5/12/18 (hora de Brasília "crua"), aplicados
// direto sobre getHours() em UTC — 16h03 Brasília (19h03 UTC) caía em "Boa noite" em
// vez de "Boa tarde". Limites convertidos para UTC (Brasília +3h), mesma conversão já
// aplicada a HORARIO_COMERCIAL_INICIO_HORA/FIM_HORA.
function calcularSaudacao(agora = new Date()) {
  const hora = agora.getHours();
  if (hora >= 8 && hora < 15) {
    return 'Bom dia';
  }
  if (hora >= 15 && hora < 21) {
    return 'Boa tarde';
  }
  return 'Boa noite';
}

function montarMensagem(corpoTemplate, nomeColaboradora, extras = {}) {
  let mensagem = corpoTemplate.replace(/\{nomeColaboradora\}/g, nomeColaboradora);

  const { diaSemana, horaSemana, saudacao } = extras || {};
  if (diaSemana !== undefined && diaSemana !== null) {
    mensagem = mensagem.replace(/\{diaSemana\}/g, diaSemana);
  }
  if (horaSemana !== undefined && horaSemana !== null) {
    mensagem = mensagem.replace(/\{horaSemana\}/g, horaSemana);
  }
  if (saudacao !== undefined && saudacao !== null) {
    mensagem = mensagem.replace(/\{saudacao\}/g, saudacao);
  }

  return mensagem;
}

function calcularProximoTemplate(templatesAtivos, ultimoTemplateUsadoId) {
  if (!templatesAtivos || templatesAtivos.length === 0) {
    return null;
  }

  const indiceAtual = templatesAtivos.findIndex((template) => template.id === ultimoTemplateUsadoId);
  if (indiceAtual === -1) {
    return templatesAtivos[0];
  }

  const proximoIndice = (indiceAtual + 1) % templatesAtivos.length;
  return templatesAtivos[proximoIndice];
}

// Wrapper em volta de disparosModel.marcarContatoFalha: grava a falha (igual
// antes) e emite 'disparo-falhou' em disparosEventsService — hoje sem
// nenhum listener assinando esse evento (a rota GET /disparos/falhas é REST
// simples, lê o banco sob demanda, não consome este emit). É só
// instrumentação disponível para uma evolução futura (ex.: notificar o
// frontend em tempo real via SSE, mesmo padrão de 'disparo-criado') sem
// precisar mudar processarItem de novo.
async function marcarFalhaEEmitir(disparoContatoId, erro, contatoNome) {
  await disparosModel.marcarContatoFalha(disparoContatoId, erro);
  disparosEventsService.emit('disparo-falhou', { disparoContatoId, contatoNome });
}

async function processarItem(item) {
  const {
    disparoContatoId,
    numeroRemetenteId,
    contatoId,
    contatoNome,
    contatoTelefone,
    tipoMensagem = 'reativacao',
    diaSemana,
    horaAgendamento,
  } = item;
  const logPrefix =
    `[envioDisparos.worker] disparoContatoId=${disparoContatoId} numeroRemetenteId=${numeroRemetenteId} ` +
    `contato="${contatoNome}" (${contatoTelefone})`;

  const statusSessao = baileysSessionService.getStatusEmMemoria(numeroRemetenteId);
  if (statusSessao !== 'conectado') {
    const erro = 'Número não está conectado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: false };
  }

  const nomeColaboradora = await numerosRemetentesModel.findNomeColaboradoraById(numeroRemetenteId);
  if (!nomeColaboradora) {
    const erro = 'Número sem nome de colaboradora configurado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: false };
  }

  const [templatesAtivos, ultimoTemplateUsadoId] = await Promise.all([
    mensagensTemplatesModel.listTemplatesAtivosOrdenados(tipoMensagem),
    mensagensTemplatesModel.getUltimoTemplateUsadoId(tipoMensagem),
  ]);
  const proximoTemplate = calcularProximoTemplate(templatesAtivos, ultimoTemplateUsadoId);

  if (!proximoTemplate) {
    const erro = 'Nenhum template de mensagem ativo cadastrado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: false };
  }

  const extras = {
    saudacao: calcularSaudacao(),
    ...(tipoMensagem === 'primeiro_contato' ? { diaSemana, horaSemana: horaAgendamento } : {}),
  };
  const mensagem = montarMensagem(proximoTemplate.corpo, nomeColaboradora, extras);

  const sock = baileysSessionService.obterSocketConectado(numeroRemetenteId);
  if (!sock) {
    const erro = 'Número não está conectado.';
    console.warn(`${logPrefix}: falha — ${erro} (sessão caiu antes do envio)`);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: false };
  }

  let resultadoVerificacao;
  try {
    resultadoVerificacao = await sock.onWhatsApp(contatoTelefone);
  } catch (err) {
    const erro = err?.message || 'Falha ao verificar número no WhatsApp.';
    console.error(`${logPrefix}: falha ao verificar número no WhatsApp — ${erro}`, err);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: true };
  }

  const entradasVerificadas = Array.isArray(resultadoVerificacao) ? resultadoVerificacao : [];
  const entradaEncontrada = entradasVerificadas.find((entrada) => entrada && entrada.exists && entrada.jid);

  if (!entradaEncontrada) {
    const erro = 'Número não possui WhatsApp ativo ou não pôde ser verificado.';
    console.warn(`${logPrefix}: falha — número sem WhatsApp ativo (onWhatsApp não retornou correspondência).`);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: true };
  }

  const jid = entradaEncontrada.jid;

  let mensagemEnviadaBaileys;
  try {
    mensagemEnviadaBaileys = await sock.sendMessage(jid, { text: mensagem });
  } catch (err) {
    const erro = err?.message || 'Falha ao enviar mensagem via WhatsApp.';
    console.error(`${logPrefix}: falha ao enviar — ${erro}`, err);
    await marcarFalhaEEmitir(disparoContatoId, erro, contatoNome);
    return { tentouEnviar: true };
  }
  await disparosModel.marcarContatoEnviado({
    disparoContatoId,
    templateUsadoId: proximoTemplate.id,
    mensagemEnviada: mensagem,
    tipoMensagem,
  });
  console.log(`${logPrefix}: enviado com sucesso (templateUsadoId=${proximoTemplate.id}).`);

  try {
    await mensagensModel.inserirMensagemEnviada({
      contatoId,
      numeroRemetenteId,
      remetente: 'ia',
      corpo: mensagem,
      baileysMessageId: mensagemEnviadaBaileys?.key?.id ?? null,
      statusEntrega: 'pendente',
    });
  } catch (err) {
    console.error(`${logPrefix}: falha ao registrar mensagem enviada em Mensagens (envio em si já teve sucesso):`, err);
  }

  return { tentouEnviar: true };
}

async function processarCicloEnvio() {
  if (!estaDentroDoHorarioComercial()) {
    return;
  }

  let itens;
  try {
    itens = await disparosModel.listContatosPendentesParaEnvio(LOTE_TAMANHO);
  } catch (err) {
    console.error('[envioDisparos.worker] falha ao buscar itens pendentes:', err);
    return;
  }

  if (!itens || itens.length === 0) {
    return;
  }

  console.log(`[envioDisparos.worker] processando ${itens.length} item(ns) pendente(s)...`);

  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i];
    let resultado = { tentouEnviar: false };

    try {
      resultado = await processarItem(item);
    } catch (err) {
      console.error(
        `[envioDisparos.worker] erro inesperado processando disparoContatoId=${item.disparoContatoId}:`,
        err
      );
    }

    const haProximoItem = i < itens.length - 1;
    if (haProximoItem && resultado.tentouEnviar) {
      await aguardar(DELAY_ENTRE_MENSAGENS_MS);
    }
  }
}

function executarCicloComGuarda(origem) {
  if (cicloEmAndamento) {
    console.warn(`[envioDisparos.worker] ciclo anterior ainda em andamento — ignorando disparo (${origem}).`);
    return;
  }

  cicloEmAndamento = true;
  processarCicloEnvio()
    .catch((err) => {
      console.error('[envioDisparos.worker] erro inesperado no ciclo:', err);
    })
    .finally(() => {
      cicloEmAndamento = false;
    });
}

function onDisparoCriado() {
  executarCicloComGuarda('evento');
}

function iniciarWorkerEnvioDisparos() {
  if (intervalHandle) {
    return;
  }

  console.log(
    `[envioDisparos.worker] iniciado (intervalo=${INTERVALO_MS}ms, loteTamanho=${LOTE_TAMANHO}, ` +
    `delayEntreMensagens=${DELAY_ENTRE_MENSAGENS_MS}ms, horarioComercial=${HORARIO_COMERCIAL_INICIO_HORA}h-` +
    `${HORARIO_COMERCIAL_FIM_HORA}h).`
  );

  intervalHandle = setInterval(() => executarCicloComGuarda('timer'), INTERVALO_MS);
  disparosEventsService.on('disparo-criado', onDisparoCriado);
}

function pararWorkerEnvioDisparos() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  disparosEventsService.off('disparo-criado', onDisparoCriado);
}

module.exports = {
  iniciarWorkerEnvioDisparos,
  pararWorkerEnvioDisparos,
  processarCicloEnvio,
  // Ponto de reuso pra produção: reenvio manual (PUT /disparos/contatos/:id/reenviar,
  // ver disparos.service.js) chama isso diretamente. Nunca passa por
  // processarCicloEnvio, então NUNCA checa estaDentroDoHorarioComercial() —
  // decisão de design deliberada, ver CLAUDE.md/contrato v12.
  processarItemUnico: processarItem,
  _processarItem: processarItem,
  _calcularProximoTemplate: calcularProximoTemplate,
  _montarMensagem: montarMensagem,
  _estaDentroDoHorarioComercial: estaDentroDoHorarioComercial,
  _calcularSaudacao: calcularSaudacao,
};
