const marketingModel = require('../models/marketing.model');

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDataRef(ano, mes) {
  const mesFormatado = String(mes).padStart(2, '0');
  return `${ano}-${mesFormatado}-01`;
}

function mesAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

function calcularPercentual(parte, total) {
  const parteNum = Number(parte) || 0;
  const totalNum = Number(total) || 0;
  return totalNum !== 0 ? round2((parteNum / totalNum) * 100) : 0;
}

function compararValor(atual, anterior) {
  const atualNum = Number(atual) || 0;
  const anteriorNum = Number(anterior) || 0;
  if (atualNum > anteriorNum) return 'subiu';
  if (atualNum < anteriorNum) return 'caiu';
  return 'igual';
}

function mapLojaRow(row) {
  const temLancamentoAtual = row.faturamentoGeral !== null && row.faturamentoGeral !== undefined;

  if (!temLancamentoAtual) {
    return {
      id: row.loja_id,
      nome: row.loja_nome,
      faturamentoGeral: null,
      faturamentoMarketing: null,
      faturamentoRetornoIndicacao: null,
      percentualMarketing: null,
      percentualRetornoIndicacao: null,
      comparacao: null,
      atualizadoEm: null,
    };
  }

  const faturamentoGeral = Number(row.faturamentoGeral);
  const faturamentoMarketing = Number(row.faturamentoMarketing);
  const faturamentoRetornoIndicacao = Number(row.faturamentoRetornoIndicacao);

  const temLancamentoAnterior = row.faturamentoGeralAnterior !== null && row.faturamentoGeralAnterior !== undefined;

  const comparacao = temLancamentoAnterior
    ? {
        faturamentoGeral: compararValor(faturamentoGeral, row.faturamentoGeralAnterior),
        faturamentoMarketing: compararValor(faturamentoMarketing, row.faturamentoMarketingAnterior),
        faturamentoRetornoIndicacao: compararValor(faturamentoRetornoIndicacao, row.faturamentoRetornoIndicacaoAnterior),
      }
    : null;

  return {
    id: row.loja_id,
    nome: row.loja_nome,
    faturamentoGeral: round2(faturamentoGeral),
    faturamentoMarketing: round2(faturamentoMarketing),
    faturamentoRetornoIndicacao: round2(faturamentoRetornoIndicacao),
    percentualMarketing: calcularPercentual(faturamentoMarketing, faturamentoGeral),
    percentualRetornoIndicacao: calcularPercentual(faturamentoRetornoIndicacao, faturamentoGeral),
    comparacao,
    atualizadoEm: row.atualizadoEm,
  };
}

function agruparPorDiretorERede(rows) {
  const blocosPorRede = new Map(); 

  for (const row of rows) {
    if (!blocosPorRede.has(row.rede_id)) {
      blocosPorRede.set(row.rede_id, {
        diretor: { id: row.diretor_id, nome: row.diretor_nome },
        rede: { id: row.rede_id, nome: row.rede_nome },
        lojas: [],
      });
    }
    blocosPorRede.get(row.rede_id).lojas.push(mapLojaRow(row));
  }

  return Array.from(blocosPorRede.values());
}

async function listarEntradas({ ano, mes }) {
  const dataRef = formatDataRef(ano, mes);
  const anterior = mesAnterior(ano, mes);
  const dataRefAnterior = formatDataRef(anterior.ano, anterior.mes);

  const rows = await marketingModel.listLojasAtivasComEntradas({ dataRef, dataRefAnterior });
  return agruparPorDiretorERede(rows);
}

async function lojaExiste(lojaId) {
  return marketingModel.existeLoja(lojaId);
}

async function salvarEntrada({ lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }) {
  const dataRef = formatDataRef(ano, mes);
  return marketingModel.upsertEntrada({
    dataRef,
    lojaId,
    faturamentoGeral,
    faturamentoMarketing,
    faturamentoRetornoIndicacao,
  });
}

async function removerEntrada({ ano, mes, lojaId }) {
  const dataRef = formatDataRef(ano, mes);
  return marketingModel.deleteEntrada({ dataRef, lojaId });
}

module.exports = {
  listarEntradas,
  lojaExiste,
  salvarEntrada,
  removerEntrada,
};
