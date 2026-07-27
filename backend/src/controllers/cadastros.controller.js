const cadastrosService = require('../services/cadastros.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * GET /api/cadastros/diretores
 */
async function listarDiretores(req, res) {
  try {
    const diretores = await cadastrosService.getDiretoresComRedes();
    return res.json(diretores);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao listar diretores:', err);
    return res.status(500).json({ error: 'Erro interno ao listar diretores.' });
  }
}

/**
 * POST /api/cadastros/diretores
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
    const resultado = await cadastrosService.criarDiretor({ nome });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um diretor com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao criar diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao criar diretor.' });
  }
}

/**
 * PUT /api/cadastros/diretores/:id
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
    const resultado = await cadastrosService.atualizarDiretor(idNum, { nome });

    if (resultado === null) {
      return res.status(404).json({ error: 'Diretor não encontrado.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um diretor com esse nome.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao atualizar diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar diretor.' });
  }
}

/**
 * DELETE /api/cadastros/diretores/:id
 */
async function excluirDiretor(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await cadastrosService.excluirDiretor(idNum);

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
    console.error('[cadastros.controller] Erro ao excluir diretor:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir diretor.' });
  }
}

/**
 * GET /api/cadastros/redes
 * Redes visíveis com diretor + responsável + lojas físicas aninhadas.
 */
async function listarRedes(req, res) {
  try {
    const redes = await cadastrosService.getRedesComDiretorResponsavelLojas();
    return res.json(redes);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao listar redes:', err);
    return res.status(500).json({ error: 'Erro interno ao listar redes.' });
  }
}

/**
 * POST /api/cadastros/redes
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
    const resultado = await cadastrosService.criarRede({ diretorId: diretorIdNum, nome, emoji });

    if (resultado === 'diretor_inexistente') {
      return res.status(400).json({ error: 'Diretor informado não existe.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma rede com esse nome neste diretor.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao criar rede:', err);
    return res.status(500).json({ error: 'Erro interno ao criar rede.' });
  }
}

/**
 * PUT /api/cadastros/redes/:id
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
    const resultado = await cadastrosService.atualizarRede(idNum, {
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
    console.error('[cadastros.controller] Erro ao atualizar rede:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar rede.' });
  }
}

/**
 * DELETE /api/cadastros/redes/:id
 */
async function excluirRede(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await cadastrosService.excluirRede(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Rede não encontrada.' });
    }

    if (resultado === 'has_lojas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta rede pois existem lojas vinculadas a ela. Remova as lojas primeiro.',
      });
    }

    if (resultado === 'has_entradas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta rede pois existem lançamentos vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[cadastros.controller] Erro ao excluir rede:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir rede.' });
  }
}

/**
 * POST /api/cadastros/lojas
 * Body: { redeId: number, nome: string }
 */
async function criarLoja(req, res) {
  const body = req.body || {};
  const { redeId, nome } = body;

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
    const resultado = await cadastrosService.criarLoja({ redeId: redeIdNum, nome });

    if (resultado === 'rede_inexistente') {
      return res.status(400).json({ error: 'Rede informada não existe.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma loja com esse nome nesta rede.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao criar loja:', err);
    return res.status(500).json({ error: 'Erro interno ao criar loja.' });
  }
}

/**
 * PUT /api/cadastros/lojas/:id
 * Body parcial: { nome?: string, ativo?: boolean } — ao menos um campo é
 * obrigatório.
 */
async function atualizarLoja(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  const body = req.body || {};
  const { nome, ativo } = body;

  if (nome === undefined && ativo === undefined) {
    return res.status(400).json({
      error: 'Informe ao menos um campo ("nome" ou "ativo") para atualizar.',
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
    const resultado = await cadastrosService.atualizarLoja(idNum, { nome, ativo });

    if (resultado === null) {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe uma loja com esse nome nesta rede.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao atualizar loja:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar loja.' });
  }
}

/**
 * DELETE /api/cadastros/lojas/:id
 */
async function excluirLoja(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({
      error: 'Parâmetro "id" deve ser um número inteiro positivo.',
    });
  }

  try {
    const resultado = await cadastrosService.excluirLoja(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Loja não encontrada.' });
    }

    if (resultado === 'has_margens_entradas') {
      return res.status(409).json({
        error:
          'Não é possível excluir esta loja pois existem lançamentos de margem vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[cadastros.controller] Erro ao excluir loja:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir loja.' });
  }
}

/**
 * GET /api/cadastros/responsaveis
 */
async function listarResponsaveis(req, res) {
  try {
    const responsaveis = await cadastrosService.getResponsaveis();
    return res.json(responsaveis);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao listar responsáveis:', err);
    return res.status(500).json({ error: 'Erro interno ao listar responsáveis.' });
  }
}

/**
 * POST /api/cadastros/responsaveis
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
    const resultado = await cadastrosService.criarResponsavel({ nome });

    if (resultado === 'nome_duplicado') {
      return res.status(409).json({ error: 'Já existe um responsável com esse nome.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[cadastros.controller] Erro ao criar responsável:', err);
    return res.status(500).json({ error: 'Erro interno ao criar responsável.' });
  }
}

/**
 * DELETE /api/cadastros/responsaveis/:id
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
    const resultado = await cadastrosService.excluirResponsavel(idNum);

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
    console.error('[cadastros.controller] Erro ao excluir responsável:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir responsável.' });
  }
}

module.exports = {
  listarDiretores,
  criarDiretor,
  atualizarDiretor,
  excluirDiretor,
  listarRedes,
  criarRede,
  atualizarRede,
  excluirRede,
  criarLoja,
  atualizarLoja,
  excluirLoja,
  listarResponsaveis,
  criarResponsavel,
  excluirResponsavel,
};
