const rankingModel = require('../models/ranking.model');
const brevoEmailService = require('./brevoEmail.service');

/**
 * Camada de regra de negócio do módulo Ranking.
 * Não conhece Express (req/res) — recebe/retorna dados já validados
 * pelo controller e delega o acesso a dados ao model.
 */

async function getEntradas({ data, categoriaId }) {
  return rankingModel.listEntradas({ data, categoriaId });
}

async function salvarEntrada({ data, categoriaId, lojaId, valor }) {
  return rankingModel.upsertEntrada({ data, categoriaId, lojaId, valor });
}

async function getRedesComLojas() {
  return rankingModel.listRedesComLojas();
}

async function getCategorias() {
  return rankingModel.listCategorias();
}

/**
 * Cria uma nova rede e retorna o objeto completo (com `lojas: []`, já que
 * uma rede recém-criada nunca tem lojas ainda).
 * Retorna 'nome_duplicado' se já existir uma rede com o mesmo nome
 * (case-insensitive, ignorando espaços extras).
 */
async function criarRede({ nome, responsavel }) {
  const duplicado = await rankingModel.existeRedeComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  const redeCriada = await rankingModel.insertRede({ nome, responsavel });
  return { ...redeCriada, lojas: [] };
}

/**
 * Atualiza parcialmente uma rede existente e retorna o objeto completo
 * (com `lojas[]`), `null` se a rede não existir, ou 'nome_duplicado' se o
 * novo nome já pertencer a outra rede (case-insensitive, ignorando espaços
 * extras).
 */
async function atualizarRede(id, { nome, responsavel, visivel }) {
  const existente = await rankingModel.findRedeById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await rankingModel.existeRedeComNome(nome, id);
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await rankingModel.updateRede(id, { nome, responsavel, visivel });
  return rankingModel.getRedeComLojasById(id);
}

/**
 * Exclui uma rede, bloqueando com conflito se houver qualquer loja
 * vinculada (independente do valor de `ativo`).
 * Retorna 'not_found' | 'has_lojas' | 'deleted'.
 */
async function excluirRede(id) {
  return rankingModel.deleteRedeIfNoLojas(id);
}

/**
 * Cria uma nova loja vinculada a uma rede existente.
 * Retorna 'rede_inexistente' | 'nome_duplicado' | a loja criada.
 * 'nome_duplicado' quando já existe uma loja com o mesmo nome
 * (case-insensitive, ignorando espaços extras) dentro da mesma rede.
 */
async function criarLoja({ redeId, nome, emoji }) {
  const rede = await rankingModel.findRedeById(redeId);
  if (!rede) {
    return 'rede_inexistente';
  }

  const duplicado = await rankingModel.existeLojaComNomeNaRede({ nome, redeId });
  if (duplicado) {
    return 'nome_duplicado';
  }

  return rankingModel.insertLoja({ redeId, nome, emoji });
}

/**
 * Atualiza parcialmente uma loja existente e retorna o objeto completo,
 * `null` se a loja não existir, ou 'nome_duplicado' se o novo nome já
 * pertencer a outra loja da mesma rede (case-insensitive, ignorando
 * espaços extras). Esta rota não permite trocar a loja de rede, então a
 * comparação usa o `rede_id` atual da loja.
 */
async function atualizarLoja(id, { nome, emoji, ativo }) {
  const existente = await rankingModel.findLojaById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await rankingModel.existeLojaComNomeNaRede({
      nome,
      redeId: existente.rede_id,
      excludeId: id,
    });
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await rankingModel.updateLoja(id, { nome, emoji, ativo });
  return rankingModel.findLojaById(id);
}

/**
 * Exclui uma loja, bloqueando com conflito se houver qualquer entrada
 * vinculada.
 * Retorna 'not_found' | 'has_entradas' | 'deleted'.
 */
async function excluirLoja(id) {
  return rankingModel.deleteLojaIfNoEntradas(id);
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
  getRedesComLojas,
  getCategorias,
  criarRede,
  atualizarRede,
  excluirRede,
  criarLoja,
  atualizarLoja,
  excluirLoja,
  enviarRelatorioEmail,
};
