const disparosModel = require('../models/disparos.model');

const ORDENS_VALIDAS = ['nome_asc', 'nome_desc', 'recentes'];

async function listarPainelDisparo() {
  return disparosModel.listPainelDisparo();
}

async function listarContatosDisponiveis(estadoId, { busca, ordem } = {}) {
  const ordemNormalizada = ORDENS_VALIDAS.includes(ordem) ? ordem : 'nome_asc';
  const buscaNormalizada =
    typeof busca === 'string' && busca.trim().length > 0 ? busca.trim() : undefined;

  return disparosModel.listContatosDisponiveis(estadoId, {
    busca: buscaNormalizada,
    ordem: ordemNormalizada,
  });
}

async function verificarDisparo({ estadoId, numeroRemetenteId, contatoIds }) {
  const contatoIdsUnicos = [...new Set(contatoIds)];

  return disparosModel.verificarDisparo({
    estadoId,
    numeroRemetenteId,
    contatoIds: contatoIdsUnicos,
  });
}

async function criarDisparo({ estadoId, numeroRemetenteId, usuarioId, contatoIds }) {
  const contatoIdsUnicos = [...new Set(contatoIds)];

  return disparosModel.criarDisparo({
    estadoId,
    numeroRemetenteId,
    usuarioId,
    contatoIds: contatoIdsUnicos,
  });
}

async function detalharDisparo(id) {
  return disparosModel.findDisparoDetalhe(id);
}

module.exports = {
  listarPainelDisparo,
  listarContatosDisponiveis,
  verificarDisparo,
  criarDisparo,
  detalharDisparo,
};
