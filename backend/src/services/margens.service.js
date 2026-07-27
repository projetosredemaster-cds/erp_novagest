const margensModel = require('../models/margens.model');

/**
 * Camada de regra de negócio do módulo Margens.
 * Não conhece Express (req/res) — recebe/retorna dados já validados
 * pelo controller e delega o acesso a dados ao model.
 *
 * Diretor/Rede/Loja/Responsavel são cadastro compartilhado (módulo
 * Cadastros); este service só lê essas tabelas via o model para validar
 * `lojaId` e montar o relatório agrupado — nenhum CRUD delas vive aqui.
 */

/**
 * Lista os lançamentos de margem de uma data específica.
 */
async function getEntradasDoDia(data) {
  return margensModel.listEntradasPorData(data);
}

/**
 * Verifica se a loja informada existe (usado pelo controller para validar
 * `lojaId` antes de aceitar o restante do corpo — ver CONTRATO-MARGENS-API.md,
 * seção 2).
 */
async function lojaExiste(lojaId) {
  return margensModel.existeLoja(lojaId);
}

/**
 * Cria ou atualiza (upsert) uma entrada de margem para (data, lojaId).
 * Assume que a existência de `lojaId` já foi validada pelo chamador (ver
 * `lojaExiste`) — não repete a checagem aqui.
 */
async function salvarEntrada({ data, lojaId, faturamento, franquia, custos, cartoes, despesas }) {
  return margensModel.upsertEntrada({ data, lojaId, faturamento, franquia, custos, cartoes, despesas });
}

/**
 * Arredonda para 2 casas decimais, evitando erro de ponto flutuante (ex:
 * 44.440000000000005) nos campos calculados do relatório.
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula os campos de margem de uma loja a partir dos totais somados no
 * período (ver fórmulas em CONTRATO-MARGENS-API.md, seção 3). Retorna `null`
 * quando `fatSemFranquia` é 0 — a loja deve ser omitida do relatório.
 */
function calcularMargemLoja(linha) {
  const faturamento = Number(linha.faturamento) || 0;
  const franquia = Number(linha.franquia) || 0;
  const custos = Number(linha.custos) || 0;
  const cartoes = Number(linha.cartoes) || 0;
  const despesas = Number(linha.despesas) || 0;

  const fatSemFranquia = faturamento - franquia;
  if (fatSemFranquia === 0) {
    return null;
  }

  const lucroBruto = fatSemFranquia - custos - cartoes;
  const lucroLiquido = lucroBruto - despesas;
  const percentualLucroBruto = (lucroBruto / fatSemFranquia) * 100;
  const percentualLucroLiquido = (lucroLiquido / fatSemFranquia) * 100;
  const cor = percentualLucroBruto >= 41 ? 'verde' : percentualLucroBruto >= 40 ? 'amarelo' : 'vermelho';

  return {
    diretor: { id: linha.diretor_id, nome: linha.diretor_nome },
    rede: {
      id: linha.rede_id,
      nome: linha.rede_nome,
      responsavel: linha.responsavel_id != null
        ? { id: linha.responsavel_id, nome: linha.responsavel_nome }
        : null,
    },
    loja: {
      id: linha.loja_id,
      nome: linha.loja_nome,
      faturamento: round2(faturamento),
      fatSemFranquia: round2(fatSemFranquia),
      lucroBruto: round2(lucroBruto),
      lucroLiquido: round2(lucroLiquido),
      percentualLucroBruto: round2(percentualLucroBruto),
      percentualLucroLiquido: round2(percentualLucroLiquido),
      cor,
    },
  };
}

/**
 * Agrupa a lista plana de lojas calculadas em blocos por (Diretor, Rede),
 * cada um com o array `lojas[]` aninhado — mesmo shape de resposta descrito
 * em CONTRATO-MARGENS-API.md, seção 3.
 */
function agruparPorDiretorERede(lojasCalculadas) {
  const blocosPorRede = new Map(); // redeId -> { diretor, rede, lojas: [] }

  for (const item of lojasCalculadas) {
    if (!blocosPorRede.has(item.rede.id)) {
      blocosPorRede.set(item.rede.id, { diretor: item.diretor, rede: item.rede, lojas: [] });
    }
    blocosPorRede.get(item.rede.id).lojas.push(item.loja);
  }

  return Array.from(blocosPorRede.values());
}

/**
 * Monta o relatório de margem do período [dataInicio, dataFim], agrupado
 * por Diretor -> Rede -> Lojas[], já com os campos calculados e omitindo
 * lojas sem lançamento efetivo no período (`fatSemFranquia` teórico 0).
 */
async function getRelatorio({ dataInicio, dataFim }) {
  const linhas = await margensModel.getSomasPorLojaNoPeriodo({ dataInicio, dataFim });

  const lojasCalculadas = linhas
    .map(calcularMargemLoja)
    .filter((loja) => loja !== null);

  return agruparPorDiretorERede(lojasCalculadas);
}

module.exports = {
  getEntradasDoDia,
  lojaExiste,
  salvarEntrada,
  getRelatorio,
};
