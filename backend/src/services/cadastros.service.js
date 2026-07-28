const cadastrosModel = require('../models/cadastros.model');

/**
 * Camada de regra de negócio do módulo Cadastros.
 * Não conhece Express (req/res) — recebe/retorna dados já validados
 * pelo controller e delega o acesso a dados ao model.
 */

async function getDiretoresComRedes() {
  return cadastrosModel.listDiretoresComRedes();
}

/**
 * Cria um novo diretor e retorna o objeto completo (com `redes: []`, já que
 * um diretor recém-criado nunca tem redes ainda).
 * Retorna 'nome_duplicado' se já existir um diretor com o mesmo nome
 * (case-insensitive, ignorando espaços extras).
 */
async function criarDiretor({ nome }) {
  const duplicado = await cadastrosModel.existeDiretorComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  const diretorCriado = await cadastrosModel.insertDiretor({ nome });
  return { ...diretorCriado, redes: [] };
}

/**
 * Atualiza o nome de um diretor existente e retorna o objeto completo (com
 * `redes[]`), `null` se o diretor não existir, ou 'nome_duplicado' se o novo
 * nome já pertencer a outro diretor (case-insensitive, ignorando espaços
 * extras).
 */
async function atualizarDiretor(id, { nome }) {
  const existente = await cadastrosModel.findDiretorById(id);
  if (!existente) {
    return null;
  }

  if (nome !== undefined) {
    const duplicado = await cadastrosModel.existeDiretorComNome(nome, id);
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await cadastrosModel.updateDiretor(id, { nome });
  return cadastrosModel.getDiretorComRedesById(id);
}

/**
 * Exclui um diretor, bloqueando com conflito se houver qualquer rede
 * vinculada.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 */
async function excluirDiretor(id) {
  return cadastrosModel.deleteDiretorIfNoRedes(id);
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
  const diretor = await cadastrosModel.findDiretorById(diretorId);
  if (!diretor) {
    return 'diretor_inexistente';
  }

  const duplicado = await cadastrosModel.existeRedeComNomeNoDiretor({ nome, diretorId });
  if (duplicado) {
    return 'nome_duplicado';
  }

  return cadastrosModel.insertRede({ diretorId, nome, emoji });
}

/**
 * Lista todas as redes visíveis com diretor + responsável + lojas físicas
 * aninhadas. Ver CONTRATO-CADASTROS-API.md, seção 5.
 */
async function getRedesComDiretorResponsavelLojas() {
  return cadastrosModel.listRedesComDiretorResponsavelLojas();
}

/**
 * Atualiza parcialmente uma rede existente e retorna o objeto completo,
 * `null` se a rede não existir, 'nome_duplicado' se o novo nome já
 * pertencer a outra rede do mesmo diretor de destino (case-insensitive,
 * ignorando espaços extras), 'responsavel_inexistente' se `responsavelId`
 * for informado (não nulo) mas não corresponder a nenhum `Responsaveis.id`
 * existente, ou 'diretor_inexistente' se `diretorId` for informado mas não
 * corresponder a nenhum `Diretores.id` existente. Quando `diretorId` é
 * informado (reatribuição), a checagem de nome duplicado usa o diretor de
 * destino, não o de origem.
 */
async function atualizarRede(id, { nome, emoji, responsavelId, ativo, visivel, diretorId }) {
  const existente = await cadastrosModel.findRedeById(id);
  if (!existente) {
    return null;
  }

  if (diretorId !== undefined) {
    const diretorExiste = await cadastrosModel.existeDiretor(diretorId);
    if (!diretorExiste) {
      return 'diretor_inexistente';
    }
  }

  if (nome !== undefined) {
    const diretorIdParaChecagem = diretorId !== undefined ? diretorId : existente.diretor_id;
    const duplicado = await cadastrosModel.existeRedeComNomeNoDiretor({
      nome,
      diretorId: diretorIdParaChecagem,
      excludeId: id,
    });
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  if (responsavelId !== undefined && responsavelId !== null) {
    const existe = await cadastrosModel.existeResponsavel(responsavelId);
    if (!existe) {
      return 'responsavel_inexistente';
    }
  }

  await cadastrosModel.updateRede(id, { nome, emoji, responsavelId, ativo, visivel, diretorId });
  return cadastrosModel.findRedeById(id);
}

/**
 * Exclui uma rede, bloqueando com conflito se houver qualquer entrada
 * vinculada.
 * Retorna 'not_found' | 'has_entradas' | 'deleted'.
 */
async function excluirRede(id) {
  return cadastrosModel.deleteRedeIfNoEntradas(id);
}

/**
 * Cria uma nova loja física vinculada a uma rede existente.
 * Retorna 'rede_inexistente' | 'nome_duplicado' | a loja criada.
 */
async function criarLoja({ redeId, nome }) {
  const redeExiste = await cadastrosModel.existeRede(redeId);
  if (!redeExiste) {
    return 'rede_inexistente';
  }

  const duplicado = await cadastrosModel.existeLojaComNomeNaRede({ nome, redeId });
  if (duplicado) {
    return 'nome_duplicado';
  }

  return cadastrosModel.insertLoja({ redeId, nome });
}

/**
 * Atualiza parcialmente uma loja existente (`nome`/`ativo`/`redeId`) e
 * retorna o objeto completo, `null` se a loja não existir,
 * 'nome_duplicado' se o novo nome já pertencer a outra loja da rede de
 * destino, ou 'rede_inexistente' se `redeId` for informado mas não
 * corresponder a nenhum `Redes.id` existente. Quando `redeId` é informado
 * (reatribuição), a checagem de nome duplicado usa a rede de destino, não
 * a de origem.
 */
async function atualizarLoja(id, { nome, ativo, redeId }) {
  const existente = await cadastrosModel.findLojaById(id);
  if (!existente) {
    return null;
  }

  if (redeId !== undefined) {
    const redeExiste = await cadastrosModel.existeRede(redeId);
    if (!redeExiste) {
      return 'rede_inexistente';
    }
  }

  if (nome !== undefined) {
    const redeIdParaChecagem = redeId !== undefined ? redeId : existente.rede_id;
    const duplicado = await cadastrosModel.existeLojaComNomeNaRede({
      nome,
      redeId: redeIdParaChecagem,
      excludeId: id,
    });
    if (duplicado) {
      return 'nome_duplicado';
    }
  }

  await cadastrosModel.updateLoja(id, { nome, ativo, redeId });
  return cadastrosModel.findLojaById(id);
}

/**
 * Lista todos os responsáveis cadastrados.
 */
async function getResponsaveis() {
  return cadastrosModel.listResponsaveis();
}

/**
 * Cria um novo responsável. Retorna 'nome_duplicado' se já existir um
 * responsável com o mesmo nome (case-insensitive, ignorando espaços extras).
 */
async function criarResponsavel({ nome }) {
  const duplicado = await cadastrosModel.existeResponsavelComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  return cadastrosModel.insertResponsavel({ nome });
}

/**
 * Exclui um responsável, bloqueando com conflito se houver qualquer rede
 * vinculada (`Redes.responsavel_id`).
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 */
async function excluirResponsavel(id) {
  return cadastrosModel.deleteResponsavelIfNoRedes(id);
}

module.exports = {
  getDiretoresComRedes,
  criarDiretor,
  atualizarDiretor,
  excluirDiretor,
  criarRede,
  getRedesComDiretorResponsavelLojas,
  atualizarRede,
  excluirRede,
  criarLoja,
  atualizarLoja,
  getResponsaveis,
  criarResponsavel,
  excluirResponsavel,
};
