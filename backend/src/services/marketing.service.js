const marketingModel = require('../models/marketing.model');

/**
 * Camada de regra de negócio do módulo Marketing.
 * Não conhece Express (req/res) — recebe/retorna dados já validados
 * pelo controller e delega o acesso a dados ao model.
 *
 * Diretor/Rede/Loja são cadastro compartilhado (módulo Cadastros); este
 * service só lê essas tabelas via o model para montar a listagem agrupada
 * e para validar `lojaId` — nenhum CRUD delas vive aqui.
 */

/**
 * Arredonda para 2 casas decimais, evitando erro de ponto flutuante (ex:
 * 44.440000000000005) nos campos calculados.
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Monta a data de referência (dia 1 do mês) no formato `YYYY-MM-DD`, a
 * partir de `ano`/`mes` já validados pelo controller.
 */
function formatDataRef(ano, mes) {
  const mesFormatado = String(mes).padStart(2, '0');
  return `${ano}-${mesFormatado}-01`;
}

/**
 * Calcula (ano, mes) do mês imediatamente anterior a (ano, mes).
 */
function mesAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

/**
 * Calcula o percentual de `parte` sobre `total`, 0 quando `total` é 0
 * (evita divisão por zero — comportamento não especificado no contrato
 * para esse caso extremo, decisão análoga a `percentualMargem` em
 * Margens).
 */
function calcularPercentual(parte, total) {
  const parteNum = Number(parte) || 0;
  const totalNum = Number(total) || 0;
  return totalNum !== 0 ? round2((parteNum / totalNum) * 100) : 0;
}

/**
 * Compara um valor atual com o valor do mês anterior, retornando
 * "subiu" | "caiu" | "igual" (ver CONTRATO-MARKETING-API.md, seção 1).
 */
function compararValor(atual, anterior) {
  const atualNum = Number(atual) || 0;
  const anteriorNum = Number(anterior) || 0;
  if (atualNum > anteriorNum) return 'subiu';
  if (atualNum < anteriorNum) return 'caiu';
  return 'igual';
}

/**
 * Converte uma linha crua (loja + lançamento atual/anterior, já com JOIN de
 * Diretor/Rede) no shape de resposta de uma loja da API (ver
 * CONTRATO-MARKETING-API.md, seção 1). Lojas sem lançamento no mês pedido
 * (`faturamentoGeral` nulo na linha crua) vêm com todos os campos de
 * valor/percentual/comparação/atualizadoEm como `null`, mesmo aparecendo no
 * array.
 */
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

/**
 * Agrupa a lista plana de linhas (loja + diretor + rede) em blocos por
 * (Diretor, Rede), cada um com o array `lojas[]` aninhado — mesmo shape de
 * resposta descrito em CONTRATO-MARKETING-API.md, seção 1.
 */
function agruparPorDiretorERede(rows) {
  const blocosPorRede = new Map(); // redeId -> { diretor, rede, lojas: [] }

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

/**
 * Lista todas as Lojas ativas, agrupadas Diretor -> Rede -> Loja, cada uma
 * com o lançamento de marketing de (ano, mes) e a comparação já calculada
 * contra o mês anterior (ver CONTRATO-MARKETING-API.md, seção 1).
 */
async function listarEntradas({ ano, mes }) {
  const dataRef = formatDataRef(ano, mes);
  const anterior = mesAnterior(ano, mes);
  const dataRefAnterior = formatDataRef(anterior.ano, anterior.mes);

  const rows = await marketingModel.listLojasAtivasComEntradas({ dataRef, dataRefAnterior });
  return agruparPorDiretorERede(rows);
}

/**
 * Verifica se a loja informada existe (usado pelo controller para validar
 * `lojaId` antes de aceitar o restante do corpo — ver
 * CONTRATO-MARKETING-API.md, seção 2).
 */
async function lojaExiste(lojaId) {
  return marketingModel.existeLoja(lojaId);
}

/**
 * Cria ou atualiza (upsert) uma entrada de marketing para (ano, mes,
 * lojaId). Assume que a existência de `lojaId` já foi validada pelo
 * chamador (ver `lojaExiste`) — não repete a checagem aqui.
 */
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

/**
 * Remove a entrada de (ano, mes, lojaId), se existir. Idempotente — não
 * valida se a loja/entrada existe antes de excluir (ver
 * CONTRATO-MARKETING-API.md, seção 3). Reaproveita `formatDataRef`, mesma
 * função usada por `salvarEntrada`, para não duplicar a conversão
 * (ano, mes) -> data_ref.
 */
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
