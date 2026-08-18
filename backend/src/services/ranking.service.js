const rankingModel = require('../models/ranking.model');
const brevoEmailService = require('./brevoEmail.service');


async function getEntradas({ data, categoriaId }) {
  return rankingModel.listEntradas({ data, categoriaId });
}

async function salvarEntrada({ data, categoriaId, redeId, valor }) {
  return rankingModel.upsertEntrada({ data, categoriaId, redeId, valor });
}

async function removerEntrada({ data, categoriaId, redeId }) {
  return rankingModel.deleteEntrada({ data, categoriaId, redeId });
}

async function getCategorias() {
  return rankingModel.listCategorias();
}

async function criarCategoria({ nome }) {
  const duplicado = await rankingModel.existeCategoriaComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  return rankingModel.insertCategoria({ nome });
}

async function atualizarCategoria(id, { nome, visivel }) {
  const existente = await rankingModel.findCategoriaById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await rankingModel.existeCategoriaComNome(nome, id);
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await rankingModel.updateCategoria(id, { nome, visivel });
  return rankingModel.findCategoriaById(id);
}

async function excluirCategoria(id) {
  return rankingModel.deleteCategoriaIfAllowed(id);
}

async function enviarRelatorioEmail({ assunto, texto }) {
  return brevoEmailService.enviarRelatorioEmail({ assunto, texto });
}

module.exports = {
  getEntradas,
  salvarEntrada,
  removerEntrada,
  getCategorias,
  criarCategoria,
  atualizarCategoria,
  excluirCategoria,
  enviarRelatorioEmail,
};
