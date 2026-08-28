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

async function atualizarNumero(id, { apelido, estadoId, ativo, nomeColaboradora }) {
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

  await numerosRemetentesModel.updateNumero(id, { apelido, estadoId, ativo, nomeColaboradora });
  return numerosRemetentesModel.findNumeroById(id);
}

async function excluirNumero(id) {
  return numerosRemetentesModel.deleteNumeroIfNoVinculos(id);
}

async function obterNumeroPorId(id) {
  return numerosRemetentesModel.findNumeroById(id);
}

async function marcarConectado(id, numero) {
  await numerosRemetentesModel.updateConexao(id, { numero, statusConexao: 'conectado' });
  return numerosRemetentesModel.findNumeroById(id);
}

async function marcarDesconectado(id) {
  await numerosRemetentesModel.updateConexao(id, { numero: null, statusConexao: 'aguardando_conexao' });
  return numerosRemetentesModel.findNumeroById(id);
}

async function marcarStatusConexao(id, statusConexao) {
  await numerosRemetentesModel.updateConexao(id, { statusConexao });
  return numerosRemetentesModel.findNumeroById(id);
}

module.exports = {
  listarNumeros,
  criarNumero,
  atualizarNumero,
  excluirNumero,
  obterNumeroPorId,
  marcarConectado,
  marcarDesconectado,
  marcarStatusConexao,
};
