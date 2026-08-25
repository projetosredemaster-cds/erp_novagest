const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');

/**
 * `listarConversas`/`listarMensagens` são passagens finas para o model —
 * a lógica de negócio de fato (existência de contato, sessão conectada,
 * verificação onWhatsApp, envio) fica em `responder`, que é a única rota
 * das três que grava algo além de "marcar como lida".
 */
async function listarConversas({ busca, apenasNaoLidas } = {}) {
  return mensagensModel.listConversas({ busca, apenasNaoLidas });
}

/**
 * Wrapper fino sobre o model — quantidade de notificações não vistas
 * (mensagens que são "primeira resposta de cliente" e ainda estão
 * `lida = 0`) para o sino de notificações do frontend
 * (`GET /api/controle-ligacoes/notificacoes`).
 */
async function contarNotificacoesNaoVistas() {
  return mensagensModel.contarNotificacoesNaoVistas();
}

/**
 * Wrapper fino sobre o model — lista as notificações pendentes mais
 * recentes (mesmo passthrough de `contarNotificacoesNaoVistas`) para o
 * dropdown do sino de notificações do frontend.
 */
async function listarNotificacoesPendentes() {
  return mensagensModel.listNotificacoesPendentes();
}

/**
 * Retorna `null` quando o contato não existe (o controller decide o 404) —
 * distinção deliberada de "array vazio" (contato existe, nunca teve
 * mensagem). Quando o contato existe, retorna
 * `{ mensagens, numeroRemetenteInicial }` — `numeroRemetenteInicial` é o
 * número remetente da mensagem mais antiga daquele contato (`{id,apelido}`
 * ou `null` se nunca teve mensagem nenhuma). `numeroRemetenteAtual` não
 * entra aqui de propósito — o frontend já tem esse dado disponível na lista
 * de conversas carregada previamente (ver CONTRATO-CONTROLE-LIGACOES-API.md,
 * seção "Central de Mensagens (v7)").
 */
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

/**
 * Envia uma resposta manual (remetente='colaboradora') para um contato via
 * o número remetente da última mensagem daquela conversa. Retorna:
 *   { status: 'contato_nao_encontrado' } |
 *   { status: 'sem_historico' } |
 *   { status: 'numero_desconectado' } |
 *   { status: 'sem_whatsapp', erro } |
 *   { status: 'falha_envio', erro } |
 *   { status: 'enviada', mensagem }
 */
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
