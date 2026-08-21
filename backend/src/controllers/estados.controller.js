const estadosService = require('../services/estados.service');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidUf(value) {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim());
}

function isValidDddItem(item) {
  return typeof item === 'string' && /^\d{2}$/.test(item.trim());
}

function isValidDddsArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isValidDddItem);
}

async function listar(req, res) {
  try {
    const estados = await estadosService.listarEstados();
    return res.json(estados);
  } catch (err) {
    console.error('[estados.controller] Erro ao listar estados:', err);
    return res.status(500).json({ error: 'Erro interno ao listar estados.' });
  }
}

async function criar(req, res) {
  const body = req.body || {};
  const { nome, uf, ddds } = body;

  if (!isNonEmptyString(nome)) {
    return res.status(400).json({ error: 'Campo "nome" é obrigatório.' });
  }

  if (!isValidUf(uf)) {
    return res.status(400).json({
      error: 'Campo "uf" é obrigatório e deve ter 2 letras.',
    });
  }

  if (!isValidDddsArray(ddds)) {
    return res.status(400).json({
      error: 'Campo "ddds" é obrigatório e deve conter ao menos um DDD válido.',
    });
  }

  try {
    const resultado = await estadosService.criarEstado({ nome, uf, ddds });

    if (resultado.status === 'uf_duplicada') {
      return res.status(409).json({ error: 'Já existe um estado com essa UF.' });
    }

    if (resultado.status === 'ddd_duplicado') {
      return res.status(409).json({
        error: `O DDD "${resultado.ddd}" já está atribuído ao estado "${resultado.estadoNome}".`,
      });
    }

    return res.status(201).json(resultado.estado);
  } catch (err) {
    console.error('[estados.controller] Erro ao criar estado:', err);
    return res.status(500).json({ error: 'Erro interno ao criar estado.' });
  }
}

module.exports = {
  listar,
  criar,
};
