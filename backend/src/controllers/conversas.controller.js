const conversasService = require('../services/conversas.service');
const mensagensEventsService = require('../services/mensagensEvents.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function parseBoolean(value) {
  return value === 'true';
}

async function listar(req, res) {
  const { busca, apenasNaoLidas } = req.query || {};

  try {
    const conversas = await conversasService.listarConversas({
      busca: typeof busca === 'string' ? busca : undefined,
      apenasNaoLidas: parseBoolean(apenasNaoLidas),
    });
    return res.json(conversas);
  } catch (err) {
    console.error('[conversas.controller] Erro ao listar conversas:', err);
    return res.status(500).json({ error: 'Erro interno ao listar conversas.' });
  }
}

async function notificacoes(req, res) {
  try {
    const [total, itens] = await Promise.all([
      conversasService.contarNotificacoesNaoVistas(),
      conversasService.listarNotificacoesPendentes(),
    ]);
    return res.json({ naoVistas: total, itens });
  } catch (err) {
    console.error('[conversas.controller] Erro ao contar notificações não vistas:', err);
    return res.status(500).json({ error: 'Erro interno ao contar notificações não vistas.' });
  }
}

async function mensagens(req, res) {
  const contatoIdNum = Number(req.params.contatoId);
  if (!isPositiveInteger(contatoIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetro "contatoId" deve ser um número inteiro positivo.' });
  }

  try {
    const resultado = await conversasService.listarMensagens(contatoIdNum);

    if (resultado === null) {
      return res.status(404).json({ error: 'Contato não encontrado.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[conversas.controller] Erro ao listar mensagens do contato:', err);
    return res.status(500).json({ error: 'Erro interno ao listar mensagens do contato.' });
  }
}

async function responder(req, res) {
  const contatoIdNum = Number(req.params.contatoId);
  if (!isPositiveInteger(contatoIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetro "contatoId" deve ser um número inteiro positivo.' });
  }

  const corpo = typeof req.body?.corpo === 'string' ? req.body.corpo.trim() : '';
  if (!corpo) {
    return res.status(400).json({ error: 'Campo "corpo" é obrigatório.' });
  }

  try {
    const resultado = await conversasService.responder(contatoIdNum, corpo);

    switch (resultado.status) {
      case 'contato_nao_encontrado':
        return res.status(404).json({ error: 'Contato não encontrado.' });
      case 'sem_historico':
        return res
          .status(400)
          .json({ error: 'Não é possível responder um contato sem histórico de conversa.' });
      case 'numero_desconectado':
        return res.status(409).json({ error: 'Número não está conectado.' });
      case 'sem_whatsapp':
        return res.status(500).json({ error: resultado.erro });
      case 'falha_envio':
        return res.status(500).json({ error: resultado.erro || 'Falha ao enviar mensagem.' });
      case 'enviada':
        return res.status(201).json({
          id: resultado.mensagem.id,
          remetente: resultado.mensagem.remetente,
          corpo: resultado.mensagem.corpo,
          criado_em: resultado.mensagem.criado_em,
        });
      default:
        return res.status(500).json({ error: 'Erro interno ao responder contato.' });
    }
  } catch (err) {
    console.error('[conversas.controller] Erro ao responder contato:', err);
    return res.status(500).json({ error: 'Erro interno ao responder contato.' });
  }
}

function stream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const onNovaMensagem = ({ contatoId, numeroRemetenteId, primeiraResposta } = {}) => {
    res.write('event: nova-mensagem\n');
    res.write(`data: ${JSON.stringify({ contatoId, numeroRemetenteId, primeiraResposta })}\n\n`);
  };

  mensagensEventsService.on('mensagem-recebida', onNovaMensagem);

  req.on('close', () => {
    mensagensEventsService.off('mensagem-recebida', onNovaMensagem);
    res.end();
  });
}

module.exports = {
  listar,
  notificacoes,
  mensagens,
  responder,
  stream,
};
