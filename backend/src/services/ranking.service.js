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

async function salvarEntrada({ data, categoriaId, redeId, valor }) {
  return rankingModel.upsertEntrada({ data, categoriaId, redeId, valor });
}

async function removerEntrada({ data, categoriaId, redeId }) {
  return rankingModel.deleteEntrada({ data, categoriaId, redeId });
}

async function getDiretoresComRedes() {
  return rankingModel.listDiretoresComRedes();
}

async function getCategorias() {
  return rankingModel.listCategorias();
}

/**
 * Cria um novo diretor e retorna o objeto completo (com `redes: []`, já que
 * um diretor recém-criado nunca tem redes ainda).
 * Retorna 'nome_duplicado' se já existir um diretor com o mesmo nome
 * (case-insensitive, ignorando espaços extras).
 */
async function criarDiretor({ nome }) {
  const duplicado = await rankingModel.existeDiretorComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  const diretorCriado = await rankingModel.insertDiretor({ nome });
  return { ...diretorCriado, redes: [] };
}

/**
 * Atualiza o nome de um diretor existente e retorna o objeto completo (com
 * `redes[]`), `null` se o diretor não existir, ou 'nome_duplicado' se o novo
 * nome já pertencer a outro diretor (case-insensitive, ignorando espaços
 * extras).
 */
async function atualizarDiretor(id, { nome }) {
  const existente = await rankingModel.findDiretorById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await rankingModel.existeDiretorComNome(nome, id);
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await rankingModel.updateDiretor(id, { nome });
  return rankingModel.getDiretorComRedesById(id);
}

/**
 * Exclui um diretor, bloqueando com conflito se houver qualquer rede
 * vinculada.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 */
async function excluirDiretor(id) {
  return rankingModel.deleteDiretorIfNoRedes(id);
}

/**
 * Cria uma nova rede vinculada a um diretor existente. Toda rede nova é
 * criada sem responsável atribuído (`responsavel: null`) — este endpoint
 * não aceita o campo `responsavelId` na criação.
 * Retorna 'diretor_inexistente' | 'nome_duplicado' | a rede criada.
 * 'nome_duplicado' quando já existe uma rede com o mesmo nome
 * (case-insensitive, ignorando espaços extras) dentro do mesmo diretor.
 */
async function criarRede({ diretorId, nome, emoji }) {
  const diretor = await rankingModel.findDiretorById(diretorId);
  if (!diretor) {
    return 'diretor_inexistente';
  }

  const duplicado = await rankingModel.existeRedeComNomeNoDiretor({ nome, diretorId });
  if (duplicado) {
    return 'nome_duplicado';
  }

  return rankingModel.insertRede({ diretorId, nome, emoji });
}

/**
 * Atualiza parcialmente uma rede existente e retorna o objeto completo,
 * `null` se a rede não existir, 'nome_duplicado' se o novo nome já
 * pertencer a outra rede do mesmo diretor (case-insensitive, ignorando
 * espaços extras), ou 'responsavel_inexistente' se `responsavelId` for
 * informado (não nulo) mas não corresponder a nenhum `Responsaveis.id`
 * existente. Esta rota não permite trocar a rede de diretor, então a
 * comparação de nome usa o `diretor_id` atual da rede.
 */
async function atualizarRede(id, { nome, emoji, responsavelId, ativo, visivel }) {
  const existente = await rankingModel.findRedeById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await rankingModel.existeRedeComNomeNoDiretor({
      nome,
      diretorId: existente.diretor_id,
      excludeId: id,
    });
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  if (responsavelId !== undefined && responsavelId !== null) {
    const existe = await rankingModel.existeResponsavel(responsavelId);
    if (!existe) {
      return 'responsavel_inexistente';
    }
  }

  await rankingModel.updateRede(id, { nome, emoji, responsavelId, ativo, visivel });
  return rankingModel.findRedeById(id);
}

/**
 * Exclui uma rede, bloqueando com conflito se houver qualquer entrada
 * vinculada.
 * Retorna 'not_found' | 'has_entradas' | 'deleted'.
 */
async function excluirRede(id) {
  return rankingModel.deleteRedeIfNoEntradas(id);
}

/**
 * Envia o texto do relatório diário (já montado pelo frontend) por e-mail,
 * via Brevo. Repassa o erro tal como veio de brevoEmail.service (incluindo o
 * flag `brevoError`, usado pelo controller para diferenciar 502 de 500).
 */
async function enviarRelatorioEmail({ assunto, texto }) {
  return brevoEmailService.enviarRelatorioEmail({ assunto, texto });
}

/**
 * Lista todos os responsáveis cadastrados.
 */
async function getResponsaveis() {
  return rankingModel.listResponsaveis();
}

/**
 * Cria um novo responsável. Retorna 'nome_duplicado' se já existir um
 * responsável com o mesmo nome (case-insensitive, ignorando espaços extras).
 */
async function criarResponsavel({ nome }) {
  const duplicado = await rankingModel.existeResponsavelComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  return rankingModel.insertResponsavel({ nome });
}

/**
 * Exclui um responsável, bloqueando com conflito se houver qualquer rede
 * vinculada (`Redes.responsavel_id`).
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 */
async function excluirResponsavel(id) {
  return rankingModel.deleteResponsavelIfNoRedes(id);
}

module.exports = {
  getEntradas,
  salvarEntrada,
  removerEntrada,
  getDiretoresComRedes,
  getCategorias,
  criarDiretor,
  atualizarDiretor,
  excluirDiretor,
  criarRede,
  atualizarRede,
  excluirRede,
  enviarRelatorioEmail,
  getResponsaveis,
  criarResponsavel,
  excluirResponsavel,
};
