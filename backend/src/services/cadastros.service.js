const cadastrosModel = require('../models/cadastros.model');

async function getDiretoresComRedes() {
  return cadastrosModel.listDiretoresComRedes();
}

async function criarDiretor({ nome }) {
  const duplicado = await cadastrosModel.existeDiretorComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  const diretorCriado = await cadastrosModel.insertDiretor({ nome });
  return { ...diretorCriado, redes: [] };
}

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

async function excluirDiretor(id) {
  return cadastrosModel.deleteDiretorIfNoRedes(id);
}

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

async function getRedesComDiretorResponsavelLojas() {
  return cadastrosModel.listRedesComDiretorResponsavelLojas();
}

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

async function excluirRede(id) {
  return cadastrosModel.deleteRedeIfNoEntradas(id);
}

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

async function getResponsaveis() {
  return cadastrosModel.listResponsaveis();
}

async function criarResponsavel({ nome }) {
  const duplicado = await cadastrosModel.existeResponsavelComNome(nome);
  if (duplicado) {
    return 'nome_duplicado';
  }

  return cadastrosModel.insertResponsavel({ nome });
}

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
