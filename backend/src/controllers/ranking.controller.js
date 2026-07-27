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
 * GET /api/ranking/diretores
 */
async function listarDiretores(req, res) {
  try {
    const diretores = await rankingService.getDiretoresComRedes();
    return res.json(diretores);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar diretores:', err);
    return res.status(500).json({ error: 'Erro interno ao listar diretores.' });
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
 * POST /api/ranking/diretores
 * Body: { nome: string }
 */
async function criarDiretor(req, res) {
  const body = req.body || {};
  const { nome } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarDiretor({ nome });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um diretor com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao criar diretor.' });
  }
}

/**
 * PUT /api/ranking/diretores/:id
 * Body: { nome: string } — atualização parcial, mas só `nome` existe neste
 * nível, então é obrigatório.
 */
async function atualizarDiretor(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.atualizarDiretor(idNum, { nome });

    if (resultado === null) {
      return res.status(404).json({ error: 'Diretor não encontrado.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um diretor com esse nome.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao atualizar diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar diretor.' });
  }
}

/**
 * DELETE /api/ranking/diretores/:id
 */
async function excluirDiretor(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await rankingService.excluirDiretor(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Diretor não encontrado.' });
    }

    if (resultado === 'has_redes') {
      return res.status(409).json({
        error:
          'Não é possível excluir este diretor pois existem redes vinculadas a ele. Remova as redes primeiro.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir diretor.' });
  }
}

/**
 * POST /api/ranking/redes
 * Body: { diretorId: number, nome: string, emoji?: string }
 */
async function criarRede(req, res) {
  const body = req.body || {};
  const { diretorId, nome, emoji } = body;

  const diretorIdNum = Number(diretorId);
  if (!isPositiveInteger(diretorIdNum)) {
    return res.status(400).json({
      error: 'Campo "diretorId" é obrigatório e deve ser um número inteiro positivo.',
    });
  }

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarRede({ diretorId: diretorIdNum, nome, emoji });

    if (resultado === 'diretor_inexistente') {
      return res.status(400).json({ error: 'Diretor informado não existe.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma rede com esse nome neste diretor.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar rede:', err);
    return res.status(500).json({ error: 'Erro interno ao criar rede.' });
  }
}

/**
 * PUT /api/ranking/redes/:id
 * Body parcial: { nome?: string, emoji?: string, responsavelId?: number|null,
 * ativo?: boolean, visivel?: boolean } — ao menos um campo é obrigatório.
 * `responsavelId` aceita `null` explícito para desatribuir; ausência do
 * campo no corpo preserva o valor atual (mesmo princípio de `nome`/`emoji`/
 * `ativo`/`visivel`).
 */
async function atualizarRede(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome, emoji, responsavelId, ativo, visivel } = body;

  if (
    nome === undefined &&
    emoji === undefined &&
    responsavelId === undefined &&
    ativo === undefined &&
    visivel === undefined
  ) {
    return res.status(400).json({
      error:
        'Informe ao menos um campo ("nome", "emoji", "responsavelId", "ativo" ou "visivel") para atualizar.',
    });
  }

  if (nome !== undefined && !isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome", quando enviado, não pode ser vazio.',
    });
  }

  let responsavelIdValue = responsavelId;
  if (responsavelId !== undefined && responsavelId !== null) {
    const responsavelIdNum = Number(responsavelId);
    if (!isPositiveInteger(responsavelIdNum)) {
      return res.status(400).json({
        error: 'Campo "responsavelId", quando enviado, deve ser um número inteiro positivo ou null.',
      });
    }
    responsavelIdValue = responsavelIdNum;
  }

  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({
      error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".',
    });
  }

  if (visivel !== undefined && typeof visivel !== 'boolean') {
    return res.status(400).json({
      error: 'Campo "visivel", quando enviado, deve ser "true" ou "false".',
    });
  }

  try {
    const resultado = await rankingService.atualizarRede(idNum, {
      nome,
      emoji,
      responsavelId: responsavelIdValue,
      ativo,
      visivel,
    });

    if (resultado === null) {
      return res.status(404).json({ error: 'Rede não encontrada.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma rede com esse nome neste diretor.' });
    }

    if (resultado === 'responsavel_inexistente') {
      return res.status(400).json({ error: 'Responsável informado não existe.' });
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

    if (resultado === 'has_entradas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta rede pois existem lançamentos vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir rede:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir rede.' });
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

/**
 * GET /api/ranking/responsaveis
 */
async function listarResponsaveis(req, res) {
  try {
    const responsaveis = await rankingService.getResponsaveis();
    return res.json(responsaveis);
  } catch (err) {
    console.error('[ranking.controller] Erro ao listar responsáveis:', err);
    return res.status(500).json({ error: 'Erro interno ao listar responsáveis.' });
  }
}

/**
 * POST /api/ranking/responsaveis
 * Body: { nome: string }
 * Restrito a admin (adminMiddleware aplicado na rota).
 */
async function criarResponsavel(req, res) {
  const body = req.body || {};
  const { nome } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({
      error: 'Campo "nome" é obrigatório e não pode ser vazio.',
    });
  }

  try {
    const resultado = await rankingService.criarResponsavel({ nome });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um responsável com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[ranking.controller] Erro ao criar responsável:', err);
    return res.status(500).json({ error: 'Erro interno ao criar responsável.' });
  }
}

/**
 * DELETE /api/ranking/responsaveis/:id
 * Restrito a admin (adminMiddleware aplicado na rota).
 */
async function excluirResponsavel(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await rankingService.excluirResponsavel(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Responsável não encontrado.' });
    }

    if (resultado === 'has_redes') {
      return res.status(409).json({
        error:
          'Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[ranking.controller] Erro ao excluir responsável:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir responsável.' });
  }
}

module.exports = {
  listarEntradas,
  criarOuAtualizarEntrada,
  listarDiretores,
  listarCategorias,
  criarDiretor,
  atualizarDiretor,
  excluirDiretor,
  criarRede,
  atualizarRede,
  excluirRede,
  enviarRelatorioEmail,
  listarResponsaveis,
  criarResponsavel,
  excluirResponsavel,
};
