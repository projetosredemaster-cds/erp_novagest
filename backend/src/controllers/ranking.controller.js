const rankingService = require('../services/ranking.service');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * GET /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X
 */
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

/**
 * POST /api/ranking/entradas
 * Body: { data: 'YYYY-MM-DD', categoriaId: number, redeId: number, valor: number }
 * Cria ou atualiza (upsert) a entrada correspondente a (data, categoriaId, redeId).
 */
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

/**
 * DELETE /api/ranking/entradas?data=YYYY-MM-DD&categoriaId=X&redeId=Y
 * Remove a entrada de (data, categoriaId, redeId). Idempotente: 204 tanto se
 * a linha existia quanto se não existia (ver CONTRATO-RANKING-API.md, 4).
 */
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

/**
 * GET /api/ranking/categorias
 */
async function listarCategorias(req, res) {
  try {
    const categorias = await rankingService.getCategorias();
    return res.json(categorias);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar categorias:', err);
    return res.status(500).json({ error: 'Erro interno ao listar categorias.' });
  }
}

/**
 * POST /api/ranking/relatorio/email
 * Body: { texto: string, assunto?: string }
 * Envia o texto do relatório (já montado no frontend) por e-mail via Brevo.
 */
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
  enviarRelatorioEmail,
};
