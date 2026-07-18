const rankingService = require('../services/ranking.service');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
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
 * Body: { data: 'YYYY-MM-DD', categoriaId: number, lojaId: number, valor: number }
 * Cria ou atualiza (upsert) a entrada correspondente a (data, categoriaId, lojaId).
 */
async function criarOuAtualizarEntrada(req, res) {
  const body = req.body || {};
  const { data, categoriaId, lojaId, valor } = body;

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

  const lojaIdNum = Number(lojaId);
  if (!isPositiveInteger(lojaIdNum)) {
    return res.status(400).json({
      error: 'Campo "lojaId" é obrigatório e deve ser um número inteiro positivo.',
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
      lojaId: lojaIdNum,
      valor: valorNum,
    });
    return res.status(200).json(entrada);
  } catch (err) {
    console.error('[ranking.controller] Erro ao salvar entrada:', err);
    return res.status(500).json({ error: 'Erro interno ao salvar entrada.' });
  }
}

/**
 * GET /api/ranking/redes
 */
async function listarRedes(req, res) {
  try {
    const redes = await rankingService.getRedesComLojas();
    return res.json(redes);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar redes:', err);
    return res.status(500).json({ error: 'Erro interno ao listar redes.' });
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * POST /api/ranking/redes
 * Body: { nome: string, responsavel?: string }
 */
async function criarRede(req, res) {
  const body = req.body || {};
  const { nome, responsavel } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarRede({ nome, responsavel });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma rede com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar rede:', err);
    return res.status(500).json({ error: 'Erro interno ao criar rede.' });
  }
}

/**
 * PUT /api/ranking/redes/:id
 * Body parcial: { nome?: string, responsavel?: string }
 */
async function atualizarRede(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome, responsavel } = body;

  if (nome === undefined && responsavel === undefined) {
    return res.status(400).json({
      error: 'Informe ao menos um campo ("nome" ou "responsavel") para atualizar.',
    });
  }

  if (nome !== undefined && !isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome", quando enviado, não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.atualizarRede(idNum, { nome, responsavel });

    if (resultado === null) {
      return res.status(404).json({ error: 'Rede não encontrada.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma rede com esse nome.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao atualizar rede:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar rede.' });
  }
}

/**
 * DELETE /api/ranking/redes/:id
 */
async function excluirRede(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await rankingService.excluirRede(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Rede não encontrada.' });
    }

    if (resultado === 'has_lojas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta rede pois existem lojas vinculadas a ela. Remova as lojas primeiro.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir rede:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir rede.' });
  }
}

/**
 * POST /api/ranking/lojas
 * Body: { redeId: number, nome: string, emoji?: string }
 */
async function criarLoja(req, res) {
  const body = req.body || {};
  const { redeId, nome, emoji } = body;

  const redeIdNum = Number(redeId);
  if (!isPositiveInteger(redeIdNum)) {
    return res.status(400).json({
      error: 'Campo "redeId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarLoja({ redeId: redeIdNum, nome, emoji });

    if (resultado === 'rede_inexistente') {
      return res.status(400).json({ error: 'Rede informada não existe.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma loja com esse nome nesta rede.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar loja:', err);
    return res.status(500).json({ error: 'Erro interno ao criar loja.' });
  }
}

/**
 * PUT /api/ranking/lojas/:id
 * Body parcial: { nome?: string, emoji?: string, ativo?: boolean }
 */
async function atualizarLoja(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome, emoji, ativo } = body;

  if (nome === undefined && emoji === undefined && ativo === undefined) {
    return res.status(400).json({
      error: 'Informe ao menos um campo ("nome", "emoji" ou "ativo") para atualizar.',
    });
  }

  if (nome !== undefined && !isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome", quando enviado, não pode ser vazio.',
    });
  }

  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({
      error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".',
    });
  }

  try {
    const resultado = await rankingService.atualizarLoja(idNum, { nome, emoji, ativo });

    if (resultado === null) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma loja com esse nome nesta rede.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao atualizar loja:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar loja.' });
  }
}

/**
 * DELETE /api/ranking/lojas/:id
 */
async function excluirLoja(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await rankingService.excluirLoja(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (resultado === 'has_entradas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta loja pois existem entradas de vendas vinculadas a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir loja:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir loja.' });
  }
}

module.exports = {
  listarEntradas,
  criarOuAtualizarEntrada,
  listarRedes,
  listarCategorias,
  criarRede,
  atualizarRede,
  excluirRede,
  criarLoja,
  atualizarLoja,
  excluirLoja,
};
