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

async function listarMensagens(contatoId) {
  const existe = await mensagensModel.existeContato(contatoId);
  if (!existe) {
    return null;
  }

  const [mensagens, numeroRemetenteInicial] = await Promise.all([
    mensagensModel.listMensagensEMarcarLidas(contatoId),
    mensagensModel.findPrimeiroNumeroRemetenteDaConversa(contatoId),
  ]);

  return { mensagens, numeroRemetenteInicial };
}

async function responder(contatoId, corpo) {
  const existe = await mensagensModel.existeContato(contatoId);
  if (!existe) {
    return { status: 'contato_nao_encontrado' };
  }

  const numeroRemetenteId = await mensagensModel.findUltimoNumeroRemetenteDaConversa(contatoId);
  if (!numeroRemetenteId) {
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

  try {
    await sock.sendMessage(entradaEncontrada.jid, { text: corpo });
  } catch (err) {
    return { status: 'falha_envio', erro: err?.message || 'Falha ao enviar mensagem.' };
  }

  const mensagem = await mensagensModel.inserirMensagemEnviada({
    contatoId,
    numeroRemetenteId,
    remetente: 'colaboradora',
    corpo,
  });

  return { status: 'enviada', mensagem };
}

module.exports = {
  listarConversas,
  contarNotificacoesNaoVistas,
  listarNotificacoesPendentes,
  listarMensagens,
  responder,
};
