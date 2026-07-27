const margensService = require('../services/margens.service');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * GET /api/margens/entradas?data=YYYY-MM-DD
 */
async function listarEntradas(req, res) {
  const { data } = req.query;

  if (!data || !DATE_REGEX.test(data)) {
    return res.status(400).json({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  }

  try {
    const entradas = await margensService.getEntradasDoDia(data);
    return res.json(entradas);
  } catch (err) {
    console.error('[margens.controller] Erro ao listar entradas de margem:', err);
    return res.status(500).json({ error: 'Erro interno ao listar entradas de margem.' });
  }
}

/**
 * POST /api/margens/entradas
 * Body: { data, lojaId, faturamento, franquia?, custos, cartoes, despesas? }
 * Cria ou atualiza (upsert) a entrada correspondente a (data, lojaId).
 *
 * Ordem de validação 400, conforme CONTRATO-MARGENS-API.md seção 2: data ->
 * lojaId/existência -> faturamento/custos/cartoes -> franquia/despesas. A
 * checagem de existência de `lojaId` é feita antes das demais validações
 * numéricas de propósito, para respeitar essa ordem mesmo quando múltiplos
 * campos do corpo são inválidos ao mesmo tempo.
 */
async function criarOuAtualizarEntrada(req, res) {
  const body = req.body || {};
  const { data, lojaId, faturamento, franquia, custos, cartoes, despesas } = body;

  if (!data || !DATE_REGEX.test(data)) {
    return res.status(400).json({
      error: 'Campo "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  }

  const lojaIdNum = Number(lojaId);
  const lojaIdFormatoValido = isPositiveInteger(lojaIdNum);

  try {
    const lojaExiste = lojaIdFormatoValido ? await margensService.lojaExiste(lojaIdNum) : false;
    if (!lojaExiste) {
      return res.status(400).json({ error: 'Loja informada não existe.' });
    }

    const faturamentoNum = Number(faturamento);
    if (faturamento === undefined || faturamento === null || Number.isNaN(faturamentoNum) || faturamentoNum < 0) {
      return res.status(400).json({
        error: 'Campo "faturamento" é obrigatório e deve ser um número maior ou igual a zero.',
      });
    }

    const custosNum = Number(custos);
    if (custos === undefined || custos === null || Number.isNaN(custosNum) || custosNum < 0) {
      return res.status(400).json({
        error: 'Campo "custos" é obrigatório e deve ser um número maior ou igual a zero.',
      });
    }

    const cartoesNum = Number(cartoes);
    if (cartoes === undefined || cartoes === null || Number.isNaN(cartoesNum) || cartoesNum < 0) {
      return res.status(400).json({
        error: 'Campo "cartoes" é obrigatório e deve ser um número maior ou igual a zero.',
      });
    }

    let franquiaNum = 0;
    if (franquia !== undefined && franquia !== null) {
      franquiaNum = Number(franquia);
      if (Number.isNaN(franquiaNum) || franquiaNum < 0) {
        return res.status(400).json({
          error: 'Campo "franquia", quando enviado, deve ser um número maior ou igual a zero.',
        });
      }
    }

    let despesasNum = 0;
    if (despesas !== undefined && despesas !== null) {
      despesasNum = Number(despesas);
      if (Number.isNaN(despesasNum) || despesasNum < 0) {
        return res.status(400).json({
          error: 'Campo "despesas", quando enviado, deve ser um número maior ou igual a zero.',
        });
      }
    }

    const entrada = await margensService.salvarEntrada({
      data,
      lojaId: lojaIdNum,
      faturamento: faturamentoNum,
      franquia: franquiaNum,
      custos: custosNum,
      cartoes: cartoesNum,
      despesas: despesasNum,
    });
    return res.status(200).json(entrada);
  } catch (err) {
    console.error('[margens.controller] Erro ao salvar entrada de margem:', err);
    return res.status(500).json({ error: 'Erro interno ao salvar entrada de margem.' });
  }
}

/**
 * GET /api/margens/relatorio?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD
 */
async function gerarRelatorio(req, res) {
  const { dataInicio, dataFim } = req.query;

  if (!dataInicio || !DATE_REGEX.test(dataInicio) || !dataFim || !DATE_REGEX.test(dataFim)) {
    return res.status(400).json({
      error: 'Parâmetros "dataInicio" e "dataFim" são obrigatórios e devem estar no formato YYYY-MM-DD.',
    });
  }

  try {
    const relatorio = await margensService.getRelatorio({ dataInicio, dataFim });
    return res.json(relatorio);
  } catch (err) {
    console.error('[margens.controller] Erro ao gerar relatório de margens:', err);
    return res.status(500).json({ error: 'Erro interno ao gerar relatório de margens.' });
  }
}

module.exports = {
  listarEntradas,
  criarOuAtualizarEntrada,
  gerarRelatorio,
};
