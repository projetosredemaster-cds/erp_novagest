const numerosRemetentesModel = require('../models/numerosRemetentes.model');

async function listarNumeros() {
  return numerosRemetentesModel.listNumeros();
}

async function criarNumero({ apelido, estadoId }) {
  const estadoExiste = await numerosRemetentesModel.existeEstado(estadoId);
  if (!estadoExiste) {
    return 'estado_inexistente';
  }

  return numerosRemetentesModel.insertNumero({ apelido, estadoId });
}

async function atualizarNumero(id, { apelido, estadoId, ativo, nomeColaboradora }) {
  const numeroExistente = await numerosRemetentesModel.findNumeroById(id);
  if (!numeroExistente) {
    return null;
  }

  if (estadoId !== undefined) {
    const estadoExiste = await numerosRemetentesModel.existeEstado(estadoId);
    if (!estadoExiste) {
      return 'estado_inexistente';
    }
  }

  await numerosRemetentesModel.updateNumero(id, { apelido, estadoId, ativo, nomeColaboradora });
  return numerosRemetentesModel.findNumeroById(id);
}

async function excluirNumero(id) {
  return numerosRemetentesModel.deleteNumeroIfNoVinculos(id);
}

/**
 * Busca um número remetente por id, sem nenhuma regra de negócio adicional.
 * Usado pelas rotas de conexão Baileys para checar 404 e o `statusConexao`
 * atual antes de decidir se abre uma sessão nova ou não.
 */
async function obterNumeroPorId(id) {
  return numerosRemetentesModel.findNumeroById(id);
}

/**
 * Persiste a confirmação de conexão Baileys: grava o telefone real
 * devolvido pela sessão e marca status_conexao = 'conectado'.
 */
async function marcarConectado(id, numero) {
  await numerosRemetentesModel.updateConexao(id, { numero, statusConexao: 'conectado' });
  return numerosRemetentesModel.findNumeroById(id);
}

/**
 * Persiste uma desconexão (manual, via POST .../desconectar, ou definitiva
 * após esgotar as tentativas de reconexão automática): limpa `numero` e
 * volta `status_conexao` para 'aguardando_conexao'.
 */
async function marcarDesconectado(id) {
  await numerosRemetentesModel.updateConexao(id, { numero: null, statusConexao: 'aguardando_conexao' });
  return numerosRemetentesModel.findNumeroById(id);
}

/**
 * Atualiza só o status_conexao, preservando o `numero` já gravado. Usado
 * quando uma sessão que estava 'conectado' cai inesperadamente e as
 * tentativas automáticas de reconexão se esgotam sem sucesso — marcamos
 * 'desconectado' (diferente de 'aguardando_conexao', que é reservado para
 * quando o operador nunca chegou a conectar ou desconectou de propósito).
 */
async function marcarStatusConexao(id, statusConexao) {
  await numerosRemetentesModel.updateConexao(id, { statusConexao });
  return numerosRemetentesModel.findNumeroById(id);
}

module.exports = {
  listarNumeros,
  criarNumero,
  atualizarNumero,
  excluirNumero,
  obterNumeroPorId,
  marcarConectado,
  marcarDesconectado,
  marcarStatusConexao,
};
