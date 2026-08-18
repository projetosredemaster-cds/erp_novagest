const rankingService = require('../services/ranking.service');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function listarEntradas(req, res) {
  const { data, categoriaId } = req.query;

  if (!data || !DATE_REGEX.test(data)) {
    return res.status(400).json({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  }

  const categoriaIdNum = Number(categoriaId);
  if (!categoriaId || !isPositiveInteger(categoriaIdNum)) {
    return res.status(400).json({
      error: 'Parâmetro "categoriaId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  try {
    const entradas = await rankingService.getEntradas({ data, categoriaId: categoriaIdNum });
    return res.json(entradas);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar entradas:', err);
    return res.status(500).json({ error: 'Erro interno ao listar entradas.' });
  }
}

async function criarOuAtualizarEntrada(req, res) {
  const body = req.body || {};
  const { data, categoriaId, redeId, valor } = body;

  if (!data || !DATE_REGEX.test(data)) {
    return res.status(400).json({
      error: 'Campo "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  }

  const categoriaIdNum = Number(categoriaId);
  if (!isPositiveInteger(categoriaIdNum)) {
    return res.status(400).json({
      error: 'Campo "categoriaId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  const redeIdNum = Number(redeId);
  if (!isPositiveInteger(redeIdNum)) {
    return res.status(400).json({
      error: 'Campo "redeId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  const valorNum = Number(valor);
  if (valor === undefined || valor === null || Number.isNaN(valorNum) || valorNum < 0) {
    return res.status(400).json({
      error: 'Campo "valor" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  }

  try {
    const entrada = await rankingService.salvarEntrada({
      data,
      categoriaId: categoriaIdNum,
      redeId: redeIdNum,
      valor: valorNum,
    });
    return res.status(200).json(entrada);
  } catch (err) {
    console.error('[ranking.controller] Erro ao salvar entrada:', err);
    return res.status(500).json({ error: 'Erro interno ao salvar entrada.' });
  }
}

async function excluirEntrada(req, res) {
  const { data, categoriaId, redeId } = req.query;

  if (!data || !DATE_REGEX.test(data)) {
    return res.status(400).json({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  }

  const categoriaIdNum = Number(categoriaId);
  if (!categoriaId || !isPositiveInteger(categoriaIdNum)) {
    return res.status(400).json({
      error: 'Parâmetro "categoriaId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  const redeIdNum = Number(redeId);
  if (!redeId || !isPositiveInteger(redeIdNum)) {
    return res.status(400).json({
      error: 'Parâmetro "redeId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  try {
    await rankingService.removerEntrada({
      data,
      categoriaId: categoriaIdNum,
      redeId: redeIdNum,
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir entrada:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir entrada.' });
  }
}

async function listarCategorias(req, res) {
  try {
    const categorias = await rankingService.getCategorias();
    return res.json(categorias);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar categorias:', err);
    return res.status(500).json({ error: 'Erro interno ao listar categorias.' });
  }
}

async function criarCategoria(req, res) {
  const body = req.body || {};
  const { nome } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarCategoria({ nome });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma categoria com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao criar categoria.' });
  }
}

async function atualizarCategoria(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome, visivel } = body;

  if (nome !== undefined && !isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome", quando enviado, não pode ser vazio.',
    });
  }

  if (visivel !== undefined && typeof visivel !== 'boolean') {
    return res.status(400).json({
      error: 'Campo "visivel", quando enviado, deve ser "true" ou "false".',
    });
  }

  try {
    const resultado = await rankingService.atualizarCategoria(idNum, { nome, visivel });

    if (resultado === null) {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma categoria com esse nome.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao atualizar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar categoria.' });
  }
}
async function excluirCategoria(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await rankingService.excluirCategoria(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Categoria não encontrada.' });
    }

    if (resultado === 'is_padrao') {
      return res.status(409).json({
        error:
          'Não é possível excluir uma categoria padrão do sistema. Utilize a opção de ocultar.',
      });
    }

    if (resultado === 'has_entradas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta categoria pois existem lançamentos vinculados a ela.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir categoria.' });
  }
}
async function enviarRelatorioEmail(req, res) {
  const body = req.body || {};
  const { texto, assunto } = body;

  if (!isNonEmptyString(texto)) {
    return res.status(400).json({
      error: 'Campo "texto" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    await rankingService.enviarRelatorioEmail({
      texto,
      assunto: isNonEmptyString(assunto) ? assunto : 'Relatório de vendas',
    });
    return res.status(200).json({ enviado: true });
  } catch (err) {
    if (err.brevoError) {
      console.error('[ranking.controller] Erro retornado pelo Brevo ao enviar relatório:', err.brevoStatus, err.brevoBody);
      return res.status(502).json({
        error: 'Erro ao enviar e-mail via Brevo: ' + (err.message || 'erro desconhecido.'),
      });
    }
    console.error('[ranking.controller] Erro ao enviar relatório por e-mail:', err);
    return res.status(500).json({ error: 'Erro interno ao enviar relatório por e-mail.' });
  }
}

module.exports = {
  listarEntradas,
  criarOuAtualizarEntrada,
  excluirEntrada,
  listarCategorias,
  criarCategoria,
  atualizarCategoria,
  excluirCategoria,
  enviarRelatorioEmail,
};
