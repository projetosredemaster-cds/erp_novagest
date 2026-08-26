const dashboardModel = require('../models/dashboard.model');
const estadosModel = require('../models/estados.model');

async function getDashboard(estadoId) {
  return dashboardModel.getDashboard(estadoId);
}

async function existeEstado(estadoId) {
  return estadosModel.existeEstado(estadoId);
}

module.exports = {
  getDashboard,
  existeEstado,
};
