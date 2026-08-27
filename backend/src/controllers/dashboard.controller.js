const dashboardService = require('../services/dashboard.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

async function getDashboard(req, res) {
  const { estadoId, dataInicio, dataFim } = req.query || {};

  let estadoIdNum = null;

  if (estadoId !== undefined && estadoId !== null && estadoId !== '') {
    const parsed = Number(estadoId);
    if (!isPositiveInteger(parsed)) {
      return res
        .status(400)
        .json({ error: 'Parâmetro "estadoId" deve ser um número inteiro positivo.' });
    }
    estadoIdNum = parsed;
  }

  try {
    if (estadoIdNum !== null) {
      const existe = await dashboardService.existeEstado(estadoIdNum);
      if (!existe) {
        return res.status(400).json({ error: 'Estado não encontrado.' });
      }
    }

    const dashboard = await dashboardService.getDashboard({
      estadoId: estadoIdNum,
      dataInicio: typeof dataInicio === 'string' ? dataInicio : undefined,
      dataFim: typeof dataFim === 'string' ? dataFim : undefined,
    });
    return res.status(200).json(dashboard);
  } catch (err) {
    console.error('[dashboard.controller] Erro ao buscar dashboard:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar dashboard.' });
  }
}

module.exports = {
  getDashboard,
};
