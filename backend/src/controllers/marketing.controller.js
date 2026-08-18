const marketingService = require('../services/marketing.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isAnoMesValido(anoNum, mesNum) {
  return Number.isInteger(anoNum) && Number.isInteger(mesNum) && mesNum >= 1 && mesNum <= 12;
}

async function listarEntradas(req, res) {
  const { ano, mes } = req.query;
  const anoNum = Number(ano);
  const mesNum = Number(mes);

  if (ano === undefined || mes === undefined || !isAnoMesValido(anoNum, mesNum)) {
    return res.status(400).json({
      error: 'Parâmetros "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  }

  try {
    const entradas = await marketingService.listarEntradas({ ano: anoNum, mes: mesNum });
    return res.json(entradas);
  } catch (err) {
    console.error('[marketing.controller] Erro ao listar entradas de marketing:', err);
    return res.status(500).json({ error: 'Erro interno ao listar entradas de marketing.' });
  }
}
async function criarOuAtualizarEntrada(req, res) {
  const body = req.body || {};
  const { lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao } = body;

  const lojaIdNum = Number(lojaId);
  const lojaIdFormatoValido = isPositiveInteger(lojaIdNum);

  try {
    const lojaExiste = lojaIdFormatoValido ? await marketingService.lojaExiste(lojaIdNum) : false;
    if (!lojaExiste) {
      return res.status(400).json({ error: 'Loja informada não existe.' });
    }

    const anoNum = Number(ano);
    const mesNum = Number(mes);
    if (ano === undefined || mes === undefined || !isAnoMesValido(anoNum, mesNum)) {
      return res.status(400).json({
        error: 'Campos "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
      });
    }

    const faturamentoGeralNum = Number(faturamentoGeral);
    if (
      faturamentoGeral === undefined ||
      faturamentoGeral === null ||
      Number.isNaN(faturamentoGeralNum) ||
      faturamentoGeralNum < 0
    ) {
      return res.status(400).json({
        error: 'Campo "faturamentoGeral" é obrigatório e deve ser maior ou igual a zero.',
      });
    }

    const faturamentoMarketingNum = Number(faturamentoMarketing);
    if (
      faturamentoMarketing === undefined ||
      faturamentoMarketing === null ||
      Number.isNaN(faturamentoMarketingNum) ||
      faturamentoMarketingNum < 0
    ) {
      return res.status(400).json({
        error: 'Campo "faturamentoMarketing" é obrigatório e deve ser maior ou igual a zero.',
      });
    }

    const faturamentoRetornoIndicacaoNum = Number(faturamentoRetornoIndicacao);
    if (
      faturamentoRetornoIndicacao === undefined ||
      faturamentoRetornoIndicacao === null ||
      Number.isNaN(faturamentoRetornoIndicacaoNum) ||
      faturamentoRetornoIndicacaoNum < 0
    ) {
      return res.status(400).json({
        error: 'Campo "faturamentoRetornoIndicacao" é obrigatório e deve ser maior ou igual a zero.',
      });
    }

    const entrada = await marketingService.salvarEntrada({
      lojaId: lojaIdNum,
      ano: anoNum,
      mes: mesNum,
      faturamentoGeral: faturamentoGeralNum,
      faturamentoMarketing: faturamentoMarketingNum,
      faturamentoRetornoIndicacao: faturamentoRetornoIndicacaoNum,
    });
    return res.status(200).json(entrada);
  } catch (err) {
    console.error('[marketing.controller] Erro ao salvar entrada de marketing:', err);
    return res.status(500).json({ error: 'Erro interno ao salvar entrada de marketing.' });
  }
}
async function excluirEntrada(req, res) {
  const { ano, mes, lojaId } = req.query;
  const anoNum = Number(ano);
  const mesNum = Number(mes);
  const lojaIdNum = Number(lojaId);

  if (
    ano === undefined ||
    mes === undefined ||
    lojaId === undefined ||
    !isAnoMesValido(anoNum, mesNum) ||
    !isPositiveInteger(lojaIdNum)
  ) {
    return res.status(400).json({
      error: 'Parâmetros "ano", "mes" e "lojaId" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  }

  try {
    await marketingService.removerEntrada({
      ano: anoNum,
      mes: mesNum,
      lojaId: lojaIdNum,
    });
    return res.status(204).send();
  } catch (err) {
    console.error('[marketing.controller] Erro ao excluir entrada de marketing:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir entrada de marketing.' });
  }
}

module.exports = {
  listarEntradas,
  criarOuAtualizarEntrada,
  excluirEntrada,
};
