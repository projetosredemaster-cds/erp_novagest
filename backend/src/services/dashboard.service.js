const dashboardModel = require('../models/dashboard.model');
const estadosModel = require('../models/estados.model');

async function getDashboard({ estadoId, dataInicio, dataFim } = {}) {
  return dashboardModel.getDashboard({ estadoId, dataInicio, dataFim });
}

async function existeEstado(estadoId) {
  return estadosModel.existeEstado(estadoId);
}

module.exports = {
  getDashboard,
  existeEstado,
};
