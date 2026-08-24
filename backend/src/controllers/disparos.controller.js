const disparosService = require('../services/disparos.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
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

async function criar(req, res) {
  const body = req.body || {};
  const { estadoId, numeroRemetenteId, contatoIds } = body;

  if (!Array.isArray(contatoIds) || contatoIds.length === 0) {
    return res.status(400).json({ error: 'Campo "contatoIds" é obrigatório.' });
  }

  if (contatoIds.length > 10) {
    return res.status(400).json({ error: 'Máximo de 10 contatos por disparo.' });
  }

  const estadoIdNum = Number(estadoId);
  const numeroRemetenteIdNum = Number(numeroRemetenteId);
  const contatoIdsNum = contatoIds.map((id) => Number(id));

  // Formato inválido de estadoId/numeroRemetenteId é tratado como "número
  // remetente inválido" (mesma mensagem da checagem de existência/ativo,
  // já que os dois casos representam o mesmo problema para quem chama a
  // rota: não é possível disparar com esse número para esse estado).
  if (!isPositiveInteger(estadoIdNum) || !isPositiveInteger(numeroRemetenteIdNum)) {
    return res
      .status(400)
      .json({ error: 'Número remetente inválido para o estado informado.' });
  }

  // Da mesma forma, um contatoId em formato inválido é tratado como um
  // contato que não pertence ao estado informado.
  if (!contatoIdsNum.every(isPositiveInteger)) {
    return res
      .status(400)
      .json({ error: 'Todos os contatos devem pertencer ao estado informado.' });
  }

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

    if (resultado.status === 'contatos_invalidos') {
      return res
        .status(400)
        .json({ error: 'Todos os contatos devem pertencer ao estado informado.' });
    }

    return res.status(201).json({
      disparoId: resultado.disparoId,
      totalContatos: resultado.totalContatos,
      avisos: resultado.avisos,
    });
  } catch (err) {
    console.error('[disparos.controller] Erro ao criar disparo:', err);
    return res.status(500).json({ error: 'Erro interno ao criar disparo.' });
  }
}

module.exports = {
  painelDisparo,
  contatosDisponiveis,
  criar,
};
