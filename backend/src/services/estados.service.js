const estadosModel = require('../models/estados.model');

async function listarEstados() {
  return estadosModel.listEstadosComDDDs();
}

async function criarEstado({ nome, uf, ddds }) {
  const dddsNormalizados = [...new Set(ddds.map((ddd) => String(ddd).trim()))];
  return estadosModel.criarEstadoComDDDs({
    nome: nome.trim(),
    uf: uf.trim().toUpperCase(),
    ddds: dddsNormalizados,
  });
}

module.exports = {
  listarEstados,
  criarEstado,
};
