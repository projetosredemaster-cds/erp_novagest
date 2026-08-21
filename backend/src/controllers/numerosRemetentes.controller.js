const numerosRemetentesService = require('../services/numerosRemetentes.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function listar(req, res) {
  try {
    const numeros = await numerosRemetentesService.listarNumeros();
    return res.json(numeros);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao listar números remetentes:', err);
    return res.status(500).json({ error: 'Erro interno ao listar números remetentes.' });
  }
}

async function criar(req, res) {
  const body = req.body || {};
  const { apelido, estadoId } = body;

  if (!isNonEmptyString(apelido)) {
    return res.status(400).json({ error: 'Campo "apelido" é obrigatório.' });
  }

  const estadoIdNum = Number(estadoId);
  if (!isPositiveInteger(estadoIdNum)) {
    return res.status(400).json({ error: 'Estado informado não existe.' });
  }

  try {
    const resultado = await numerosRemetentesService.criarNumero({
      apelido: apelido.trim(),
      estadoId: estadoIdNum,
    });

    if (resultado === 'estado_inexistente') {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao criar número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao criar número remetente.' });
  }
}

async function atualizar(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  const body = req.body || {};
  const { apelido, estadoId, ativo } = body;

  if (apelido !== undefined && !isNonEmptyString(apelido)) {
    return res.status(400).json({ error: 'Campo "apelido", quando enviado, não pode ser vazio.' });
  }

  let estadoIdValue;
  if (estadoId !== undefined) {
    estadoIdValue = Number(estadoId);
    if (!isPositiveInteger(estadoIdValue)) {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }
  }

  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".' });
  }

  try {
    const resultado = await numerosRemetentesService.atualizarNumero(idNum, {
      apelido: apelido !== undefined ? apelido.trim() : undefined,
      estadoId: estadoIdValue,
      ativo,
    });

    if (resultado === null) {
      return res.status(404).json({ error: 'Número remetente não encontrado.' });
    }

    if (resultado === 'estado_inexistente') {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao atualizar número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar número remetente.' });
  }
}

async function excluir(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  try {
    const resultado = await numerosRemetentesService.excluirNumero(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Número remetente não encontrado.' });
    }

    if (resultado === 'has_vinculos') {
      return res.status(409).json({
        error:
          'Não é possível excluir este número pois existem contatos ou importações vinculadas a ele. Utilize a atualização (PUT) com ativo=false para desativá-lo.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao excluir número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir número remetente.' });
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
};
