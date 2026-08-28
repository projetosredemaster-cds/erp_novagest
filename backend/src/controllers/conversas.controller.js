const conversasService = require('../services/conversas.service');
const mensagensEventsService = require('../services/mensagensEvents.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function parseBoolean(value) {
  return value === 'true';
}

async function listar(req, res) {
  const { busca, apenasNaoLidas, numeroRemetenteId, status } = req.query || {};

  let numeroRemetenteIdNum;
  if (numeroRemetenteId !== undefined) {
    numeroRemetenteIdNum = Number(numeroRemetenteId);
    if (!isPositiveInteger(numeroRemetenteIdNum)) {
      return res
        .status(400)
        .json({ error: 'Parâmetro "numeroRemetenteId" deve ser um número inteiro positivo.' });
    }
  }

  if (status !== undefined && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: 'Parâmetro "status" inválido.' });
  }

  try {
    const conversas = await conversasService.listarConversas({
      busca: typeof busca === 'string' ? busca : undefined,
      apenasNaoLidas: parseBoolean(apenasNaoLidas),
      numeroRemetenteId: numeroRemetenteIdNum,
      status: typeof status === 'string' ? status : undefined,
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
  const numeroRemetenteIdNum = Number(req.params.numeroRemetenteId);
  if (!isPositiveInteger(contatoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.' });
  }

  try {
    const resultado = await conversasService.listarMensagens(contatoIdNum, numeroRemetenteIdNum);

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
  const numeroRemetenteIdNum = Number(req.params.numeroRemetenteId);
  if (!isPositiveInteger(contatoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.' });
  }

  const corpo = typeof req.body?.corpo === 'string' ? req.body.corpo.trim() : '';
  if (!corpo) {
    return res.status(400).json({ error: 'Campo "corpo" é obrigatório.' });
  }

  try {
    const resultado = await conversasService.responder(contatoIdNum, numeroRemetenteIdNum, corpo);

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
          status_entrega: resultado.mensagem.status_entrega,
          baileys_message_id: resultado.mensagem.baileys_message_id,
        });
      default:
        return res.status(500).json({ error: 'Erro interno ao responder contato.' });
    }
  } catch (err) {
    console.error('[conversas.controller] Erro ao responder contato:', err);
    return res.status(500).json({ error: 'Erro interno ao responder contato.' });
  }
}

const STATUS_VALIDOS = ['atendeu', 'agendou', 'nao_atendeu', 'venda', 'perdido'];
const MOTIVOS_PERDIDO_VALIDOS = [
  'nao_foi_loja',
  'foi_loja_nao_comprou',
  'preco_condicao',
  'comprou_outro_lugar',
  'desistiu_sem_resposta',
  'outro',
];

async function atualizarStatus(req, res) {
  const contatoIdNum = Number(req.params.contatoId);
  const numeroRemetenteIdNum = Number(req.params.numeroRemetenteId);
  if (!isPositiveInteger(contatoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.' });
  }

  const status = req.body?.status;
  if (typeof status !== 'string' || !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ error: 'Campo "status" inválido ou ausente.' });
  }

  const motivo = req.body?.motivo;
  if (motivo !== undefined && motivo !== null && motivo !== '' && !MOTIVOS_PERDIDO_VALIDOS.includes(motivo)) {
    return res.status(400).json({ error: 'Campo "motivo" inválido.' });
  }

  const motivoDetalhe = typeof req.body?.motivoDetalhe === 'string' ? req.body.motivoDetalhe : null;

  try {
    const resultado = await conversasService.atualizarStatus(
      contatoIdNum,
      numeroRemetenteIdNum,
      status,
      motivo ?? null,
      motivoDetalhe
    );

    if (resultado === 'atendeu_nao_permitido') {
      return res.status(400).json({
        error: "O status 'Atendeu' é definido automaticamente pelo sistema e não pode ser selecionado manualmente.",
      });
    }

    if (resultado === 'motivo_obrigatorio') {
      return res.status(400).json({ error: 'Campo "motivo" é obrigatório quando o status é "perdido".' });
    }

    return res.status(200).json({ contatoId: contatoIdNum, numeroRemetenteId: numeroRemetenteIdNum, status });
  } catch (err) {
    console.error('[conversas.controller] Erro ao atualizar status da conversa:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar status da conversa.' });
  }
}

async function pipeline(req, res) {
  const { busca, numeroRemetenteId, statusInicio, statusFim, disparoInicio, disparoFim } = req.query || {};

  let numeroRemetenteIdNum;
  if (numeroRemetenteId !== undefined) {
    numeroRemetenteIdNum = Number(numeroRemetenteId);
    if (!isPositiveInteger(numeroRemetenteIdNum)) {
      return res
        .status(400)
        .json({ error: 'Parâmetro "numeroRemetenteId" deve ser um número inteiro positivo.' });
    }
  }

  try {
    const itens = await conversasService.listarPipeline({
      busca: typeof busca === 'string' ? busca : undefined,
      numeroRemetenteId: numeroRemetenteIdNum,
      statusInicio: typeof statusInicio === 'string' ? statusInicio : undefined,
      statusFim: typeof statusFim === 'string' ? statusFim : undefined,
      disparoInicio: typeof disparoInicio === 'string' ? disparoInicio : undefined,
      disparoFim: typeof disparoFim === 'string' ? disparoFim : undefined,
    });
    return res.json(itens);
  } catch (err) {
    console.error('[conversas.controller] Erro ao listar pipeline:', err);
    return res.status(500).json({ error: 'Erro interno ao listar pipeline.' });
  }
}

async function pipelineHistorico(req, res) {
  const contatoIdNum = Number(req.params.contatoId);
  const numeroRemetenteIdNum = Number(req.params.numeroRemetenteId);
  if (!isPositiveInteger(contatoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.' });
  }

  try {
    const itens = await conversasService.listarHistoricoStatus(contatoIdNum, numeroRemetenteIdNum);
    return res.json(itens);
  } catch (err) {
    console.error('[conversas.controller] Erro ao listar histórico de status do pipeline:', err);
    return res.status(500).json({ error: 'Erro interno ao listar histórico de status do pipeline.' });
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

  const onStatusAtualizado = ({ contatoId, numeroRemetenteId, baileysMessageId, status } = {}) => {
    res.write('event: status-atualizado\n');
    res.write(`data: ${JSON.stringify({ contatoId, numeroRemetenteId, baileysMessageId, status })}\n\n`);
  };

  mensagensEventsService.on('mensagem-recebida', onNovaMensagem);
  mensagensEventsService.on('mensagem-status-atualizada', onStatusAtualizado);

  req.on('close', () => {
    mensagensEventsService.off('mensagem-recebida', onNovaMensagem);
    mensagensEventsService.off('mensagem-status-atualizada', onStatusAtualizado);
    res.end();
  });
}

module.exports = {
  listar,
  notificacoes,
  mensagens,
  responder,
  atualizarStatus,
  pipeline,
  pipelineHistorico,
  stream,
};
