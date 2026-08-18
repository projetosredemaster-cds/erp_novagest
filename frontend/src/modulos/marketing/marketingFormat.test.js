// Testes unitários das funções puras de frontend/src/modulos/marketing/marketingFormat.js.
// Foco nas funções de agregação (somarCampoLojas/percentualSobreTotal) usadas por
// TotalGeralRow.jsx, DashboardMarketing.jsx e RelatorioMarketing.jsx para calcular
// SOMA/SOMA (nunca média de percentuais individuais — bug conhecido da planilha original,
// ver comentário de origem no topo do arquivo), e nas funções de comparação/observação.
import { describe, it, expect } from 'vitest';
import {
  somarCampoLojas,
  percentualSobreTotal,
  compararTotais,
  buildObservacao,
  calcularRankingVariacao,
  variacaoPercentual,
  variacaoPontosPercentuais,
} from './marketingFormat.js';

describe('somarCampoLojas / percentualSobreTotal — agregação SOMA/SOMA, nunca média', () => {
  it('soma faturamentoGeral/faturamentoMarketing de 3 lojas com percentuais MUITO diferentes entre si e calcula o percentual sobre o TOTAL somado (não a média dos percentuais individuais)', () => {
    // Loja A: 90/100 = 90%; Loja B: 9/900 = 1%; Loja C: 100/1000 = 10%
    // Média simples dos 3 percentuais seria (90+1+10)/3 = 33,67% — errado, é o bug da planilha.
    const lojas = [
      { faturamentoGeral: 100, faturamentoMarketing: 90 },
      { faturamentoGeral: 900, faturamentoMarketing: 9 },
      { faturamentoGeral: 1000, faturamentoMarketing: 100 },
    ];

    const totalGeral = somarCampoLojas(lojas, 'faturamentoGeral');
    const totalMarketing = somarCampoLojas(lojas, 'faturamentoMarketing');
    expect(totalGeral).toBe(2000);
    expect(totalMarketing).toBe(199);

    const percentual = percentualSobreTotal(totalMarketing, totalGeral);
    // SOMA/SOMA correto: 199 / 2000 * 100 = 9,95%
    expect(percentual).toBeCloseTo(9.95, 2);
    // garante que NÃO é a média ingênua dos percentuais individuais (33,67%)
    expect(percentual).not.toBeCloseTo(33.67, 1);
  });

  it('ignora lojas com o campo null/undefined (sem lançamento no período) — não soma como zero, mas dá o mesmo resultado numérico', () => {
    const lojas = [
      { faturamentoGeral: 500, faturamentoMarketing: 50 },
      { faturamentoGeral: null, faturamentoMarketing: null }, // sem lançamento
      { faturamentoGeral: undefined, faturamentoMarketing: undefined }, // sem lançamento
    ];
    expect(somarCampoLojas(lojas, 'faturamentoGeral')).toBe(500);
    expect(somarCampoLojas(lojas, 'faturamentoMarketing')).toBe(50);
  });

  it('somarCampoLojas com array vazio/nulo retorna 0', () => {
    expect(somarCampoLojas([], 'faturamentoGeral')).toBe(0);
    expect(somarCampoLojas(null, 'faturamentoGeral')).toBe(0);
    expect(somarCampoLojas(undefined, 'faturamentoGeral')).toBe(0);
  });

  it('percentualSobreTotal retorna null quando o total geral é 0 (nunca NaN/erro de divisão por zero)', () => {
    expect(percentualSobreTotal(0, 0)).toBeNull();
    expect(percentualSobreTotal(100, 0)).toBeNull();
  });
});

describe('compararTotais', () => {
  it('subiu / caiu / igual', () => {
    expect(compararTotais(200, 100)).toBe('subiu');
    expect(compararTotais(100, 200)).toBe('caiu');
    expect(compararTotais(100, 100)).toBe('igual');
  });

  it('null quando falta um dos dois lados', () => {
    expect(compararTotais(null, 100)).toBeNull();
    expect(compararTotais(100, undefined)).toBeNull();
    expect(compararTotais(null, null)).toBeNull();
  });
});

describe('buildObservacao', () => {
  it('"SEM DADO DO MÊS ANTERIOR" quando comparacao é null', () => {
    expect(buildObservacao(null, 'MARKETING')).toBe('SEM DADO DO MÊS ANTERIOR');
  });

  it('monta a frase certa quando os dois lados sobem, usando "RENDIMENTO" (não "MARKETING") no vocabulário da aba Marketing', () => {
    const comparacao = { faturamentoGeral: 'subiu', faturamentoMarketing: 'subiu' };
    expect(buildObservacao(comparacao, 'MARKETING')).toBe('SUBIU FATURAMENTO E SUBIU RENDIMENTO');
  });

  it('usa "RETORNO/INDICAÇÃO" no vocabulário da aba correspondente', () => {
    const comparacao = { faturamentoGeral: 'caiu', faturamentoRetornoIndicacao: 'subiu' };
    expect(buildObservacao(comparacao, 'RETORNO/INDICAÇÃO')).toBe('CAIU FATURAMENTO E SUBIU RETORNO/INDICAÇÃO');
  });

  it('caso "igual" nos dois lados', () => {
    const comparacao = { faturamentoGeral: 'igual', faturamentoMarketing: 'igual' };
    expect(buildObservacao(comparacao, 'MARKETING')).toBe('FATURAMENTO ESTÁVEL E ESTÁVEL RENDIMENTO');
  });
});

describe('variacaoPercentual / variacaoPontosPercentuais', () => {
  it('variacaoPercentual: variação relativa entre dois valores absolutos', () => {
    expect(variacaoPercentual(120, 100)).toBeCloseTo(20, 5);
    expect(variacaoPercentual(80, 100)).toBeCloseTo(-20, 5);
  });

  it('variacaoPercentual: null quando o anterior é 0/null/undefined (sem base pra dividir)', () => {
    expect(variacaoPercentual(100, 0)).toBeNull();
    expect(variacaoPercentual(100, null)).toBeNull();
    expect(variacaoPercentual(100, undefined)).toBeNull();
  });

  it('variacaoPontosPercentuais: diferença em pontos percentuais (não variação relativa)', () => {
    expect(variacaoPontosPercentuais(43.8, 41.2)).toBeCloseTo(2.6, 5);
  });
});

describe('calcularRankingVariacao', () => {
  it('só inclui lojas com dado NOS DOIS meses e anterior != 0, ordenadas por variação', () => {
    const itens = [
      { id: 1, nome: 'A', atual: 200, anterior: 100 }, // +100%
      { id: 2, nome: 'B', atual: 50, anterior: 100 }, // -50%
      { id: 3, nome: 'C', atual: 300, anterior: 100 }, // +200%
      { id: 4, nome: 'D', atual: 100, anterior: null }, // sem anterior — descartada
      { id: 5, nome: 'E', atual: 100, anterior: 0 }, // anterior 0 — descartada (sem base)
      { id: 6, nome: 'F', atual: undefined, anterior: 100 }, // sem atual — descartada
    ];

    const { altas, quedas } = calcularRankingVariacao(itens);

    expect(altas.map(i => i.id)).toEqual([3, 1]); // C (+200%) antes de A (+100%)
    expect(quedas.map(i => i.id)).toEqual([2]);
  });

  it('retorna arrays vazios quando nenhum item tem dado suficiente', () => {
    const { altas, quedas } = calcularRankingVariacao([{ id: 1, nome: 'A', atual: 100, anterior: null }]);
    expect(altas).toEqual([]);
    expect(quedas).toEqual([]);
  });
});
