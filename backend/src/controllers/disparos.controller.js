const disparosService = require('../services/disparos.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}


function validarCorpoDisparo(body) {
  const { estadoId, numeroRemetenteId, contatoIds } = body;

  if (!Array.isArray(contatoIds) || contatoIds.length === 0) {
    return { erro: { status: 400, body: { error: 'Campo "contatoIds" é obrigatório.' } } };
  }

  if (contatoIds.length > 10) {
    return { erro: { status: 400, body: { error: 'Máximo de 10 contatos por disparo.' } } };
  }

  const estadoIdNum = Number(estadoId);
  const numeroRemetenteIdNum = Number(numeroRemetenteId);
  const contatoIdsNum = contatoIds.map((id) => Number(id));

  if (!isPositiveInteger(estadoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return {
      erro: {
        status: 400,
        body: { error: 'Número remetente inválido para o estado informado.' },
      },
    };
  }

  if (!contatoIdsNum.every(isPositiveInteger)) {
    return {
      erro: {
        status: 400,
        body: { error: 'Todos os contatos devem pertencer ao estado informado.' },
      },
    };
  }

  return { estadoIdNum, numeroRemetenteIdNum, contatoIdsNum };
}

async function painelDisparo(req, res) {
  try {
    const painel = await disparosService.listarPainelDisparo();
    return res.json(painel);
  } catch (err) {
    console.error('[disparos.controller] Erro ao listar painel de disparo:', err);
    return res.status(500).json({ error: 'Erro interno ao listar painel de disparo.' });
  }
}

async function contatosDisponiveis(req, res) {
  const estadoIdNum = Number(req.params.estadoId);
  if (!isPositiveInteger(estadoIdNum)) {
    return res
      .status(400)
      .json({ error: 'Parâmetro "estadoId" deve ser um número inteiro positivo.' });
  }

  const { busca, ordem } = req.query || {};

  try {
    const contatos = await disparosService.listarContatosDisponiveis(estadoIdNum, {
      busca: typeof busca === 'string' ? busca : undefined,
      ordem: typeof ordem === 'string' ? ordem : undefined,
    });
    return res.json(contatos);
  } catch (err) {
    console.error('[disparos.controller] Erro ao listar contatos disponíveis:', err);
    return res.status(500).json({ error: 'Erro interno ao listar contatos disponíveis.' });
  }
}

async function verificar(req, res) {
  const validacao = validarCorpoDisparo(req.body || {});
  if (validacao.erro) {
    return res.status(validacao.erro.status).json(validacao.erro.body);
  }

  const { estadoIdNum, numeroRemetenteIdNum, contatoIdsNum } = validacao;

  try {
    const resultado = await disparosService.verificarDisparo({
      estadoId: estadoIdNum,
      numeroRemetenteId: numeroRemetenteIdNum,
      contatoIds: contatoIdsNum,
    });

    if (resultado.status === 'numero_invalido') {
      return res
        .status(400)
        .json({ error: 'Número remetente inválido para o estado informado.' });
    }

    if (resultado.status === 'numero_desconectado') {
      return res.status(400).json({
        error: 'Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar.',
      });
    }

    if (resultado.status === 'numero_sem_colaboradora') {
      return res.status(400).json({
        error: 'Este número não tem nome da colaboradora configurado. Preencha em Configurações antes de disparar.',
      });
    }

    if (resultado.status === 'contatos_invalidos') {
      return res
        .status(400)
        .json({ error: 'Todos os contatos devem pertencer ao estado informado.' });
    }

    return res.status(200).json({ avisos: resultado.avisos });
  } catch (err) {
    console.error('[disparos.controller] Erro ao verificar disparo:', err);
    return res.status(500).json({ error: 'Erro interno ao verificar disparo.' });
  }
}

async function criar(req, res) {
  const validacao = validarCorpoDisparo(req.body || {});
  if (validacao.erro) {
    return res.status(validacao.erro.status).json(validacao.erro.body);
  }

  const { estadoIdNum, numeroRemetenteIdNum, contatoIdsNum } = validacao;

  try {
    const resultado = await disparosService.criarDisparo({
      estadoId: estadoIdNum,
      numeroRemetenteId: numeroRemetenteIdNum,
      usuarioId: req.usuario.id,
      contatoIds: contatoIdsNum,
    });

    if (resultado.status === 'numero_invalido') {
      return res
        .status(400)
        .json({ error: 'Número remetente inválido para o estado informado.' });
    }

    if (resultado.status === 'numero_desconectado') {
      return res.status(400).json({
        error: 'Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar.',
      });
    }

    if (resultado.status === 'numero_sem_colaboradora') {
      return res.status(400).json({
        error: 'Este número não tem nome da colaboradora configurado. Preencha em Configurações antes de disparar.',
      });
    }

    if (resultado.status === 'contatos_invalidos') {
      return res
        .status(400)
        .json({ error: 'Todos os contatos devem pertencer ao estado informado.' });
    }

    return res.status(201).json({
      disparoId: resultado.disparoId,
      totalContatos: resultado.totalContatos,
    });
  } catch (err) {
    console.error('[disparos.controller] Erro ao criar disparo:', err);
    return res.status(500).json({ error: 'Erro interno ao criar disparo.' });
  }
}

async function detalhe(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  try {
    const disparo = await disparosService.detalharDisparo(idNum);

    if (!disparo) {
      return res.status(404).json({ error: 'Disparo não encontrado.' });
    }

    return res.status(200).json(disparo);
  } catch (err) {
    console.error('[disparos.controller] Erro ao buscar detalhe do disparo:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar detalhe do disparo.' });
  }
}

module.exports = {
  painelDisparo,
  contatosDisponiveis,
  verificar,
  criar,
  detalhe,
};
