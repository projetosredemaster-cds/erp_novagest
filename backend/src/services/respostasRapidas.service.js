const respostasRapidasModel = require('../models/respostasRapidas.model');

async function listarRespostas() {
  return respostasRapidasModel.listAtivas();
}

async function criarResposta({ titulo, corpo, ordem }) {
  return respostasRapidasModel.insertResposta({ titulo, corpo, ordem });
}

async function atualizarResposta(id, { titulo, corpo, ordem, ativo }) {
  const respostaExistente = await respostasRapidasModel.findById(id);
  if (!respostaExistente) {
    return null;
  }

  await respostasRapidasModel.updateResposta(id, { titulo, corpo, ordem, ativo });
  return respostasRapidasModel.findById(id);
}

async function excluirResposta(id) {
  const respostaExistente = await respostasRapidasModel.findById(id);
  if (!respostaExistente) {
    return 'not_found';
  }

  await respostasRapidasModel.deleteResposta(id);
  return 'deleted';
}

module.exports = {
  listarRespostas,
  criarResposta,
  atualizarResposta,
  excluirResposta,
};
