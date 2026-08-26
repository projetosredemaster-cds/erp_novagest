const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');

async function listarConversas({ busca, apenasNaoLidas } = {}) {
  return mensagensModel.listConversas({ busca, apenasNaoLidas });
}

async function contarNotificacoesNaoVistas() {
  return mensagensModel.contarNotificacoesNaoVistas();
}

async function listarNotificacoesPendentes() {
  return mensagensModel.listNotificacoesPendentes();
}

async function listarMensagens(contatoId, numeroRemetenteId) {
  const existe = await mensagensModel.existeContato(contatoId);
  if (!existe) {
    return null;
  }

  const mensagens = await mensagensModel.listMensagensEMarcarLidas(contatoId, numeroRemetenteId);
  return { mensagens };
}

async function responder(contatoId, numeroRemetenteId, corpo) {
  const existe = await mensagensModel.existeContato(contatoId);
  if (!existe) {
    return { status: 'contato_nao_encontrado' };
  }

  const jaTemHistorico = await mensagensModel.existeMensagemNaThread(contatoId, numeroRemetenteId);
  if (!jaTemHistorico) {
    return { status: 'sem_historico' };
  }

  const sock = baileysSessionService.obterSocketConectado(numeroRemetenteId);
  if (!sock) {
    return { status: 'numero_desconectado' };
  }

  // Telefone do contato é necessário para a checagem via onWhatsApp, antes
  // de mandar a resposta.
  const telefone = await mensagensModel.findTelefoneContato(contatoId);

  let resultadoVerificacao;
  try {
    resultadoVerificacao = await sock.onWhatsApp(telefone);
  } catch (err) {
    const erro = err?.message || 'Falha ao verificar número no WhatsApp.';
    return { status: 'sem_whatsapp', erro };
  }

  const entradasVerificadas = Array.isArray(resultadoVerificacao) ? resultadoVerificacao : [];
  const entradaEncontrada = entradasVerificadas.find((entrada) => entrada && entrada.exists && entrada.jid);

  if (!entradaEncontrada) {
    return {
      status: 'sem_whatsapp',
      erro: 'Número não possui WhatsApp ativo ou não pôde ser verificado.',
    };
  }

  let mensagemEnviadaBaileys;
  try {
    mensagemEnviadaBaileys = await sock.sendMessage(entradaEncontrada.jid, { text: corpo });
  } catch (err) {
    return { status: 'falha_envio', erro: err?.message || 'Falha ao enviar mensagem.' };
  }

  const mensagem = await mensagensModel.inserirMensagemEnviada({
    contatoId,
    numeroRemetenteId,
    remetente: 'colaboradora',
    corpo,
    baileysMessageId: mensagemEnviadaBaileys?.key?.id ?? null,
    statusEntrega: 'pendente',
  });

  return { status: 'enviada', mensagem };
}

async function atualizarStatus(contatoId, numeroRemetenteId, status) {
  return mensagensModel.upsertStatusConversa(contatoId, numeroRemetenteId, status);
}

module.exports = {
  listarConversas,
  contarNotificacoesNaoVistas,
  listarNotificacoesPendentes,
  listarMensagens,
  responder,
  atualizarStatus,
};
