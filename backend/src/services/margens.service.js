const margensModel = require('../models/margens.model');

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calcularLucroEPercentual({ faturamento, custoProduto, totalTar }) {
  const fat = Number(faturamento) || 0;
  const custo = Number(custoProduto) || 0;
  const tar = Number(totalTar) || 0;
  const lucro = fat - custo - tar;
  const percentualMargem = fat !== 0 ? (lucro / fat) * 100 : 0;
  return { lucro: round2(lucro), percentualMargem: round2(percentualMargem) };
}

async function getEntradasDoDia(data) {
  const entradas = await margensModel.listEntradasPorData(data);
  return entradas.map(e => ({
    ...e,
    ...calcularLucroEPercentual(e),
  }));
}

async function lojaExiste(lojaId) {
  return margensModel.existeLoja(lojaId);
}

async function salvarEntrada({ data, lojaId, faturamento, custoProduto, totalTar, margemInformada }) {
  return margensModel.upsertEntrada({ data, lojaId, faturamento, custoProduto, totalTar, margemInformada });
}

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
