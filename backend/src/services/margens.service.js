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
 * Arredonda para 2 casas decimais, evitando erro de ponto flutuante (ex:
 * 44.440000000000005) nos campos calculados.
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * lucro/percentualMargem de uma linha (fórmulas em CONTRATO-MARGENS-API.md,
 * seção 1/3): `lucro = faturamento - custoProduto - totalTar`;
 * `percentualMargem = lucro / faturamento * 100`, 0 quando `faturamento` é 0
 * (evita divisão por zero).
 */
function calcularLucroEPercentual({ faturamento, custoProduto, totalTar }) {
  const fat = Number(faturamento) || 0;
  const custo = Number(custoProduto) || 0;
  const tar = Number(totalTar) || 0;
  const lucro = fat - custo - tar;
  const percentualMargem = fat !== 0 ? (lucro / fat) * 100 : 0;
  return { lucro: round2(lucro), percentualMargem: round2(percentualMargem) };
}

/**
 * Lista os lançamentos já confirmados numa data específica, cada um já com
 * `lucro`/`percentualMargem` calculados a partir do snapshot gravado (ver
 * CONTRATO-MARGENS-API.md, seção 1).
 */
async function getEntradasDoDia(data) {
  const entradas = await margensModel.listEntradasPorData(data);
  return entradas.map(e => ({
    ...e,
    ...calcularLucroEPercentual(e),
  }));
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
 * Cria ou atualiza (upsert) uma entrada de margem para (data, lojaId),
 * gravando o totalTar da loja junto com um snapshot do faturamento/
 * custoProduto consolidados usados neste momento. Assume que a existência
 * de `lojaId` já foi validada pelo chamador (ver `lojaExiste`) — não repete
 * a checagem aqui.
 */
async function salvarEntrada({ data, lojaId, faturamento, custoProduto, totalTar }) {
  return margensModel.upsertEntrada({ data, lojaId, faturamento, custoProduto, totalTar });
}

/**
 * Calcula os campos de margem de uma loja a partir dos totais somados no
 * período (fórmulas em CONTRATO-MARGENS-API.md, seção 3):
 *   lucro            = SUM(faturamento) - SUM(custoProduto) - SUM(totalTar)
 *   percentualMargem = lucro / SUM(faturamento) * 100
 *   cor: >= 41 verde, >= 40 amarelo, senão vermelho
 */
function calcularMargemLoja(linha) {
  const faturamento = Number(linha.faturamento) || 0;
  const custoProduto = Number(linha.custoProduto) || 0;
  const totalTar = Number(linha.totalTar) || 0;

  const { lucro, percentualMargem } = calcularLucroEPercentual({ faturamento, custoProduto, totalTar });
  const cor = percentualMargem >= 41 ? 'verde' : percentualMargem >= 40 ? 'amarelo' : 'vermelho';

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
      custoProduto: round2(custoProduto),
      totalTar: round2(totalTar),
      lucro,
      percentualMargem,
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
 * por Diretor -> Rede -> Lojas[], já com os campos calculados. Lojas sem
 * nenhum lançamento no período já vêm de fora do resultado (INNER JOIN no
 * model), então não há filtragem adicional aqui.
 */
async function getRelatorio({ dataInicio, dataFim }) {
  const linhas = await margensModel.getSomasPorLojaNoPeriodo({ dataInicio, dataFim });
  return agruparPorDiretorERede(linhas.map(calcularMargemLoja));
}

module.exports = {
  getEntradasDoDia,
  lojaExiste,
  salvarEntrada,
  getRelatorio,
};
