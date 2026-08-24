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

async function criarDisparo({ estadoId, numeroRemetenteId, usuarioId, contatoIds }) {
  // Dedup silencioso: evita colidir com o UNIQUE(disparo_id, contato_id) se
  // o mesmo id vier repetido no corpo da requisição (a validação de
  // "máximo 10" já rodou no controller sobre o array bruto).
  const contatoIdsUnicos = [...new Set(contatoIds)];

  return disparosModel.criarDisparo({
    estadoId,
    numeroRemetenteId,
    usuarioId,
    contatoIds: contatoIdsUnicos,
  });
}

module.exports = {
  listarPainelDisparo,
  listarContatosDisponiveis,
  criarDisparo,
};
