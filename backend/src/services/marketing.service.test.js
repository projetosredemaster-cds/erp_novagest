// Teste unitário de `marketing.service`, isolado do Express e do banco real —
// `marketing.model` é substituído por spies (`vi.spyOn`) que sobrescrevem os
// métodos no MESMO objeto que `marketing.service.js` usa internamente
// (garantido pelo cache de módulos do Node, compartilhado entre requires
// CJS) — ver nota detalhada em `../controllers/ranking.controller.test.js`
// sobre por que `vi.mock()` não é confiável aqui.
//
// Foco: a ramificação de cálculo de comparação (subiu/caiu/igual/null) e o
// cálculo de percentual (incluindo o caso extremo faturamentoGeral = 0), que
// são a lógica de negócio de maior risco deste módulo (histórico: o caso
// "sem mês anterior -> comparacao: null" ficou sem confirmação em um resumo
// anterior do backend-architect que implementou a feature).

const marketingModel = require('../models/marketing.model');
const marketingService = require('./marketing.service');

function rowLoja({
  diretorId = 1, diretorNome = 'Victor Hugo',
  redeId = 5, redeNome = 'Delta',
  lojaId = 40, lojaNome = 'SLZ 01',
  faturamentoGeral = null, faturamentoMarketing = null, faturamentoRetornoIndicacao = null,
  atualizadoEm = null,
  faturamentoGeralAnterior = null, faturamentoMarketingAnterior = null, faturamentoRetornoIndicacaoAnterior = null,
} = {}) {
  return {
    diretor_id: diretorId, diretor_nome: diretorNome,
    rede_id: redeId, rede_nome: redeNome,
    loja_id: lojaId, loja_nome: lojaNome,
    faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao,
    atualizadoEm,
    faturamentoGeralAnterior, faturamentoMarketingAnterior, faturamentoRetornoIndicacaoAnterior,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(marketingModel)) {
    if (typeof marketingModel[key] === 'function') {
      vi.spyOn(marketingModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] marketing.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('marketing.service.listarEntradas — formatDataRef / mesAnterior (via chamada ao model)', () => {
  it('converte (ano, mes) em dataRef (dia 1) e calcula corretamente o mês anterior', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([]);

    await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(marketingModel.listLojasAtivasComEntradas).toHaveBeenCalledWith({
      dataRef: '2026-08-01', dataRefAnterior: '2026-07-01',
    });
  });

  it('mês anterior a janeiro é dezembro do ano anterior (virada de ano)', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([]);

    await marketingService.listarEntradas({ ano: 2026, mes: 1 });

    expect(marketingModel.listLojasAtivasComEntradas).toHaveBeenCalledWith({
      dataRef: '2026-01-01', dataRefAnterior: '2025-12-01',
    });
  });
});

describe('marketing.service.listarEntradas — cálculo de comparação (subiu/caiu/igual/null)', () => {
  it('comparacao: null quando NÃO existe lançamento no mês anterior (faturamentoGeralAnterior ausente) — caso crítico, sem confirmação anterior', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        faturamentoGeral: 1000, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 50,
        faturamentoGeralAnterior: null, faturamentoMarketingAnterior: null, faturamentoRetornoIndicacaoAnterior: null,
      }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado[0].lojas[0].comparacao).toBeNull();
  });

  it('comparacao: "subiu" nos 3 campos quando o valor atual é maior que o anterior', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        faturamentoGeral: 2000, faturamentoMarketing: 200, faturamentoRetornoIndicacao: 100,
        faturamentoGeralAnterior: 1000, faturamentoMarketingAnterior: 100, faturamentoRetornoIndicacaoAnterior: 50,
      }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado[0].lojas[0].comparacao).toEqual({
      faturamentoGeral: 'subiu', faturamentoMarketing: 'subiu', faturamentoRetornoIndicacao: 'subiu',
    });
  });

  it('comparacao: "caiu" nos 3 campos quando o valor atual é menor que o anterior', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        faturamentoGeral: 500, faturamentoMarketing: 50, faturamentoRetornoIndicacao: 10,
        faturamentoGeralAnterior: 1000, faturamentoMarketingAnterior: 100, faturamentoRetornoIndicacaoAnterior: 50,
      }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado[0].lojas[0].comparacao).toEqual({
      faturamentoGeral: 'caiu', faturamentoMarketing: 'caiu', faturamentoRetornoIndicacao: 'caiu',
    });
  });

  it('comparacao: "igual" nos 3 campos quando o valor atual é idêntico ao anterior (planilha original forçava subiu/caiu; decisão nova do contrato)', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        faturamentoGeral: 1000, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 50,
        faturamentoGeralAnterior: 1000, faturamentoMarketingAnterior: 100, faturamentoRetornoIndicacaoAnterior: 50,
      }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado[0].lojas[0].comparacao).toEqual({
      faturamentoGeral: 'igual', faturamentoMarketing: 'igual', faturamentoRetornoIndicacao: 'igual',
    });
  });

  it('cada campo é comparado INDEPENDENTEMENTE — um pode subir enquanto outro cai ou fica igual', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        faturamentoGeral: 1000, faturamentoMarketing: 90, faturamentoRetornoIndicacao: 50,
        faturamentoGeralAnterior: 900, faturamentoMarketingAnterior: 100, faturamentoRetornoIndicacaoAnterior: 50,
      }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado[0].lojas[0].comparacao).toEqual({
      faturamentoGeral: 'subiu', faturamentoMarketing: 'caiu', faturamentoRetornoIndicacao: 'igual',
    });
  });
});

describe('marketing.service.listarEntradas — cálculo de percentual', () => {
  it('percentualMarketing/percentualRetornoIndicacao retornam 0 (nunca NaN/erro) quando faturamentoGeral = 0', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ faturamentoGeral: 0, faturamentoMarketing: 0, faturamentoRetornoIndicacao: 0 }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    const loja = resultado[0].lojas[0];
    expect(loja.percentualMarketing).toBe(0);
    expect(loja.percentualRetornoIndicacao).toBe(0);
    expect(Number.isNaN(loja.percentualMarketing)).toBe(false);
    expect(Number.isNaN(loja.percentualRetornoIndicacao)).toBe(false);
  });

  it('percentual calculado corretamente (arredondado a 2 casas) quando faturamentoGeral > 0', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ faturamentoGeral: 300, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 30 }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    const loja = resultado[0].lojas[0];
    expect(loja.percentualMarketing).toBeCloseTo(33.33, 2);
    expect(loja.percentualRetornoIndicacao).toBe(10);
  });
});

describe('marketing.service.listarEntradas — agrupamento Diretor/Rede/Loja', () => {
  it('agrupa múltiplas lojas da mesma rede sob o mesmo bloco {diretor, rede, lojas[]}', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ lojaId: 40, lojaNome: 'SLZ 01' }),
      rowLoja({ lojaId: 41, lojaNome: 'SLZ 02' }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].lojas).toHaveLength(2);
    expect(resultado[0].lojas.map(l => l.nome)).toEqual(['SLZ 01', 'SLZ 02']);
  });

  it('separa blocos por rede diferente, mesmo com o mesmo diretor', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ redeId: 5, redeNome: 'Delta', lojaId: 40 }),
      rowLoja({ redeId: 6, redeNome: 'Lendários', lojaId: 42 }),
    ]);

    const resultado = await marketingService.listarEntradas({ ano: 2026, mes: 8 });

    expect(resultado).toHaveLength(2);
    expect(resultado.map(b => b.rede.nome).sort()).toEqual(['Delta', 'Lendários']);
  });
});

describe('marketing.service.lojaExiste', () => {
  it('repassa o resultado do model', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    await expect(marketingService.lojaExiste(40)).resolves.toBe(true);
    expect(marketingModel.existeLoja).toHaveBeenCalledWith(40);
  });
});

describe('marketing.service.salvarEntrada', () => {
  it('converte (ano, mes) em dataRef e repassa os 3 campos de faturamento ao model.upsertEntrada', async () => {
    marketingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, lojaId: 40, dataRef: '2026-08-01T00:00:00.000Z',
      faturamentoGeral: 1000, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 50,
      atualizadoEm: '2026-08-05T14:00:00.000Z',
    });

    await marketingService.salvarEntrada({
      lojaId: 40, ano: 2026, mes: 8,
      faturamentoGeral: 1000, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 50,
    });

    expect(marketingModel.upsertEntrada).toHaveBeenCalledWith({
      dataRef: '2026-08-01', lojaId: 40,
      faturamentoGeral: 1000, faturamentoMarketing: 100, faturamentoRetornoIndicacao: 50,
    });
  });
});

describe('marketing.service.removerEntrada', () => {
  it('converte (ano, mes) em dataRef e repassa lojaId ao model.deleteEntrada', async () => {
    marketingModel.deleteEntrada.mockResolvedValue(undefined);

    await marketingService.removerEntrada({ ano: 2026, mes: 8, lojaId: 40 });

    expect(marketingModel.deleteEntrada).toHaveBeenCalledWith({ dataRef: '2026-08-01', lojaId: 40 });
  });
});
