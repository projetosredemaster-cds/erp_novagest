const numerosRemetentesModel = require('../models/numerosRemetentes.model');

async function listarNumeros() {
  return numerosRemetentesModel.listNumeros();
}

async function criarNumero({ apelido, estadoId }) {
  const estadoExiste = await numerosRemetentesModel.existeEstado(estadoId);
  if (!estadoExiste) {
    return 'estado_inexistente';
  }

  return numerosRemetentesModel.insertNumero({ apelido, estadoId });
}

async function atualizarNumero(id, { apelido, estadoId, ativo }) {
  const numeroExistente = await numerosRemetentesModel.findNumeroById(id);
  if (!numeroExistente) {
    return null;
  }

  if (estadoId !== undefined) {
    const estadoExiste = await numerosRemetentesModel.existeEstado(estadoId);
    if (!estadoExiste) {
      return 'estado_inexistente';
    }
  }

  await numerosRemetentesModel.updateNumero(id, { apelido, estadoId, ativo });
  return numerosRemetentesModel.findNumeroById(id);
}

async function excluirNumero(id) {
  return numerosRemetentesModel.deleteNumeroIfNoVinculos(id);
}

module.exports = {
  listarNumeros,
  criarNumero,
  atualizarNumero,
  excluirNumero,
};
