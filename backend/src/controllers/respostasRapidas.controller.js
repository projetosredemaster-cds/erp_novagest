const respostasRapidasService = require('../services/respostasRapidas.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function listar(req, res) {
  try {
    const respostas = await respostasRapidasService.listarRespostas();
    return res.json(respostas);
  } catch (err) {
    console.error('[respostasRapidas.controller] Erro ao listar respostas rápidas:', err);
    return res.status(500).json({ error: 'Erro interno ao listar respostas rápidas.' });
  }
}

async function criar(req, res) {
  const body = req.body || {};
  const { titulo, corpo, ordem } = body;

  if (!isNonEmptyString(titulo)) {
    return res.status(400).json({ error: 'Campo "titulo" é obrigatório.' });
  }

  if (!isNonEmptyString(corpo)) {
    return res.status(400).json({ error: 'Campo "corpo" é obrigatório.' });
  }

  let ordemValue = 0;
  if (ordem !== undefined) {
    const ordemNum = Number(ordem);
    if (!Number.isInteger(ordemNum)) {
      return res.status(400).json({ error: 'Campo "ordem", quando enviado, deve ser um número inteiro.' });
    }
    ordemValue = ordemNum;
  }

  try {
    const resultado = await respostasRapidasService.criarResposta({
      titulo: titulo.trim(),
      corpo: corpo.trim(),
      ordem: ordemValue,
    });

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[respostasRapidas.controller] Erro ao criar resposta rápida:', err);
    return res.status(500).json({ error: 'Erro interno ao criar resposta rápida.' });
  }
}

async function atualizar(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  const body = req.body || {};
  const { titulo, corpo, ordem, ativo } = body;

  if (
    titulo === undefined &&
    corpo === undefined &&
    ordem === undefined &&
    ativo === undefined
  ) {
    return res.status(400).json({ error: 'Informe ao menos um campo para atualizar.' });
  }

  if (titulo !== undefined && !isNonEmptyString(titulo)) {
    return res.status(400).json({ error: 'Campo "titulo", quando enviado, não pode ser vazio.' });
  }

  if (corpo !== undefined && !isNonEmptyString(corpo)) {
    return res.status(400).json({ error: 'Campo "corpo", quando enviado, não pode ser vazio.' });
  }

  let ordemValue;
  if (ordem !== undefined) {
    ordemValue = Number(ordem);
    if (!Number.isInteger(ordemValue)) {
      return res.status(400).json({ error: 'Campo "ordem", quando enviado, deve ser um número inteiro.' });
    }
  }

  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".' });
  }

  try {
    const resultado = await respostasRapidasService.atualizarResposta(idNum, {
      titulo: titulo !== undefined ? titulo.trim() : undefined,
      corpo: corpo !== undefined ? corpo.trim() : undefined,
      ordem: ordemValue,
      ativo,
    });

    if (resultado === null) {
      return res.status(404).json({ error: 'Resposta rápida não encontrada.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[respostasRapidas.controller] Erro ao atualizar resposta rápida:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar resposta rápida.' });
  }
}

async function excluir(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  try {
    const resultado = await respostasRapidasService.excluirResposta(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Resposta rápida não encontrada.' });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[respostasRapidas.controller] Erro ao excluir resposta rápida:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir resposta rápida.' });
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
};
