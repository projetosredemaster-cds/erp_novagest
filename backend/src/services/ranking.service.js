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
  enviarRelatorioEmail,
};
