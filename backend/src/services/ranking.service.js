const rankingModel = require('../models/ranking.model');
const brevoEmailService = require('./brevoEmail.service');

/**
 * Camada de regra de negócio do módulo Ranking.
 * Não conhece Express (req/res) — recebe/retorna dados já validados
 * pelo controller e delega o acesso a dados ao model.
 *
 * CRUD de Diretor/Rede/Responsavel foi extraído para o módulo Cadastros
 * (ver `cadastros.service.js` e CONTRATO-CADASTROS-API.md) — este service é
 * dono só de Entradas/Categorias e do envio de relatório por e-mail.
 */

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

/**
 * Cria uma nova categoria. Sempre `padrao = false`, `principal = false`,
 * `visivel = true`.
 * Retorna 'nome_duplicado' se já existir uma categoria com o mesmo nome
 * (case-insensitive, ignorando espaços extras).
 */
async function criarCategoria({ nome }) {
  const duplicado = await rankingModel.existeCategoriaComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  return rankingModel.insertCategoria({ nome });
}

/**
 * Atualiza parcialmente uma categoria existente (`nome`/`visivel`).
 * Retorna 'null' se a categoria não existir, 'nome_duplicado' se o novo nome
 * já pertencer a outra categoria (case-insensitive, ignorando espaços
 * extras), ou a categoria atualizada.
 */
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

/**
 * Exclui uma categoria, bloqueando com conflito se for padrão ou se houver
 * qualquer entrada vinculada.
 * Retorna 'not_found' | 'is_padrao' | 'has_entradas' | 'deleted'.
 */
async function excluirCategoria(id) {
  return rankingModel.deleteCategoriaIfAllowed(id);
}

/**
 * Envia o texto do relatório diário (já montado pelo frontend) por e-mail,
 * via Brevo. Repassa o erro tal como veio de brevoEmail.service (incluindo o
 * flag `brevoError`, usado pelo controller para diferenciar 502 de 500).
 */
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
