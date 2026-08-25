const disparosModel = require('../models/disparos.model');
const mensagensTemplatesModel = require('../models/mensagensTemplates.model');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');

const INTERVALO_MS = Number(process.env.ENVIO_DISPAROS_INTERVALO_MS) || 15000;
const LOTE_TAMANHO = Number(process.env.ENVIO_DISPAROS_LOTE_TAMANHO) || 5;
const DELAY_ENTRE_MENSAGENS_MS = Number(process.env.ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS) || 4000;

let intervalHandle = null;
let cicloEmAndamento = false;

function aguardar(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function montarMensagem(corpoTemplate, nomeColaboradora) {
  return corpoTemplate.replace(/\{nomeColaboradora\}/g, nomeColaboradora);
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

async function processarItem(item) {
  const { disparoContatoId, numeroRemetenteId, contatoId, contatoNome, contatoTelefone } = item;
  const logPrefix =
    `[envioDisparos.worker] disparoContatoId=${disparoContatoId} numeroRemetenteId=${numeroRemetenteId} ` +
    `contato="${contatoNome}" (${contatoTelefone})`;

  const statusSessao = baileysSessionService.getStatusEmMemoria(numeroRemetenteId);
  if (statusSessao !== 'conectado') {
    const erro = 'Número não está conectado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: false };
  }

  const nomeColaboradora = await numerosRemetentesModel.findNomeColaboradoraById(numeroRemetenteId);
  if (!nomeColaboradora) {
    const erro = 'Número sem nome de colaboradora configurado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: false };
  }

  const [templatesAtivos, ultimoTemplateUsadoId] = await Promise.all([
    mensagensTemplatesModel.listTemplatesAtivosOrdenados(),
    mensagensTemplatesModel.getUltimoTemplateUsadoId(),
  ]);
  const proximoTemplate = calcularProximoTemplate(templatesAtivos, ultimoTemplateUsadoId);

  if (!proximoTemplate) {
    const erro = 'Nenhum template de mensagem ativo cadastrado.';
    console.warn(`${logPrefix}: falha — ${erro}`);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: false };
  }

  const mensagem = montarMensagem(proximoTemplate.corpo, nomeColaboradora);

  const sock = baileysSessionService.obterSocketConectado(numeroRemetenteId);
  if (!sock) {
    const erro = 'Número não está conectado.';
    console.warn(`${logPrefix}: falha — ${erro} (sessão caiu antes do envio)`);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: false };
  }

  let resultadoVerificacao;
  try {
    resultadoVerificacao = await sock.onWhatsApp(contatoTelefone);
  } catch (err) {
    const erro = err?.message || 'Falha ao verificar número no WhatsApp.';
    console.error(`${logPrefix}: falha ao verificar número no WhatsApp — ${erro}`, err);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: true };
  }

  const entradasVerificadas = Array.isArray(resultadoVerificacao) ? resultadoVerificacao : [];
  const entradaEncontrada = entradasVerificadas.find((entrada) => entrada && entrada.exists && entrada.jid);

  if (!entradaEncontrada) {
    const erro = 'Número não possui WhatsApp ativo ou não pôde ser verificado.';
    console.warn(`${logPrefix}: falha — número sem WhatsApp ativo (onWhatsApp não retornou correspondência).`);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: true };
  }

  const jid = entradaEncontrada.jid;

  try {
    await sock.sendMessage(jid, { text: mensagem });
  } catch (err) {
    const erro = err?.message || 'Falha ao enviar mensagem via WhatsApp.';
    console.error(`${logPrefix}: falha ao enviar — ${erro}`, err);
    await disparosModel.marcarContatoFalha(disparoContatoId, erro);
    return { tentouEnviar: true };
  }
  await disparosModel.marcarContatoEnviado({
    disparoContatoId,
    templateUsadoId: proximoTemplate.id,
    mensagemEnviada: mensagem,
  });
  console.log(`${logPrefix}: enviado com sucesso (templateUsadoId=${proximoTemplate.id}).`);

  try {
    await mensagensModel.inserirMensagemEnviada({
      contatoId,
      numeroRemetenteId,
      remetente: 'ia',
      corpo: mensagem,
    });
  } catch (err) {
    console.error(`${logPrefix}: falha ao registrar mensagem enviada em Mensagens (envio em si já teve sucesso):`, err);
  }

  return { tentouEnviar: true };
}

async function processarCicloEnvio() {
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

function iniciarWorkerEnvioDisparos() {
  if (intervalHandle) {
    return;
  }

  console.log(
    `[envioDisparos.worker] iniciado (intervalo=${INTERVALO_MS}ms, loteTamanho=${LOTE_TAMANHO}, ` +
    `delayEntreMensagens=${DELAY_ENTRE_MENSAGENS_MS}ms).`
  );

  intervalHandle = setInterval(() => {
    if (cicloEmAndamento) {
      console.warn('[envioDisparos.worker] ciclo anterior ainda em andamento — pulando esta execução do timer.');
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
  }, INTERVALO_MS);
}

function pararWorkerEnvioDisparos() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  iniciarWorkerEnvioDisparos,
  pararWorkerEnvioDisparos,
  processarCicloEnvio,
  _processarItem: processarItem,
  _calcularProximoTemplate: calcularProximoTemplate,
  _montarMensagem: montarMensagem,
};
