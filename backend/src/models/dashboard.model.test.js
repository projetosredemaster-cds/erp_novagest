const dbModule = require('../config/db');
const { sql } = dbModule;

const getPoolSpy = vi.spyOn(dbModule, 'getPool');

const dashboardModel = require('./dashboard.model');
const {
  getTotalDisparos,
  getTaxas,
  getDisparosPorRegiao,
  getStatusGeral,
  getRankingAtendentes,
  getFunilConversao,
  getTendenciaDiaria,
  getComparativoSemanal,
  getTempoMedioPorEtapa,
  getTempoMedioConversao,
  getVelocidadeRespostaAtendente,
  getTaxaRecuo,
  getCaminhosComuns,
  getStatusPulados,
  getOrigemPorDia,
  getMotivosPerdido,
} = dashboardModel._internal;

function criarRequestMock() {
  return {
    input: vi.fn().mockReturnThis(),
    query: vi.fn(),
  };
}

function criarPoolMockSequencial(respostas) {
  // Cada chamada a pool.request() devolve um novo request cujo .query() resolve com a
  // próxima resposta da fila — necessário porque getComparativoSemanal chama
  // getTaxasEmPeriodo() duas vezes em paralelo, cada uma abrindo seu próprio request().
  let indice = 0;
  const pool = {
    request: vi.fn(() => {
      const request = criarRequestMock();
      const resposta = respostas[indice];
      indice += 1;
      request.query.mockResolvedValue(resposta ?? { recordset: [] });
      return request;
    }),
  };
  return pool;
}

beforeEach(() => {
  vi.restoreAllMocks();
  getPoolSpy.mockReset();
});

describe('dashboard.model.getTotalDisparos', () => {
  it('devolve 0 (não NaN/undefined) quando não há nenhum disparo no período', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ total: 0 }] });
    const pool = { request: vi.fn(() => request) };

    const total = await getTotalDisparos(pool, {});

    expect(total).toBe(0);
  });

  it('devolve 0 quando o recordset vem vazio (linha nenhuma)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const total = await getTotalDisparos(pool, {});

    expect(total).toBe(0);
  });
});

describe('dashboard.model.getTaxas', () => {
  it('todas as taxas ficam 0 (não NaN) quando não há nenhum DisparoContatos no período (NULLIF evita divisão por zero)', async () => {
    const request = criarRequestMock();
    // SQL: ROUND(... / NULLIF(COUNT(dc.id), 0), 1) — sem linhas, o driver mssql ainda devolve
    // uma linha de agregação com todos os campos NULL.
    request.query.mockResolvedValue({
      recordset: [{ atendeu: null, agendou: null, nao_atendeu: null, venda: null, perdido: null }],
    });
    const pool = { request: vi.fn(() => request) };

    const taxas = await getTaxas(pool, {});

    expect(taxas).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 0 });
  });

  it('todas as taxas ficam 100% "perdido" quando todo mundo tem status=perdido', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [{ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 100 }],
    });
    const pool = { request: vi.fn(() => request) };

    const taxas = await getTaxas(pool, {});

    expect(taxas).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 100 });
  });
});

describe('dashboard.model.getDisparosPorRegiao', () => {
  it('mapeia estado_id/nome/uf/total para camelCase parcial (estadoId) preservando os demais', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [{ estado_id: 6, nome: 'Maranhão', uf: 'MA', total: 12 }],
    });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getDisparosPorRegiao(pool, {});

    expect(resultado).toEqual([{ estadoId: 6, nome: 'Maranhão', uf: 'MA', total: 12 }]);
  });

  it('devolve array vazio quando o estadoId filtrado não bate com nenhum disparo', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getDisparosPorRegiao(pool, { estadoId: 999 });

    expect(resultado).toEqual([]);
  });
});

describe('dashboard.model.getStatusGeral', () => {
  it('devolve array vazio quando não há nenhum ConversasStatus no período', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getStatusGeral(pool, {});

    expect(resultado).toEqual([]);
  });

  it('quando todo mundo é "perdido", devolve só uma linha (perdido)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ status: 'perdido', total: 40 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getStatusGeral(pool, {});

    expect(resultado).toEqual([{ status: 'perdido', total: 40 }]);
  });
});

describe('dashboard.model.getRankingAtendentes', () => {
  it('devolve array vazio quando não há nenhum atendente/número associado a disparo no período', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getRankingAtendentes(pool, {});

    expect(resultado).toEqual([]);
  });

  it('mapeia numero_remetente_id -> numeroRemetenteId preservando os contadores por status', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [
        { numero_remetente_id: 7, apelido: 'Bruno', atendeu: 3, agendou: 1, nao_atendeu: 5, venda: 2, perdido: 1, total: 12 },
      ],
    });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getRankingAtendentes(pool, {});

    expect(resultado).toEqual([
      { numeroRemetenteId: 7, apelido: 'Bruno', atendeu: 3, agendou: 1, nao_atendeu: 5, venda: 2, perdido: 1, total: 12 },
    ]);
  });
});

describe('dashboard.model.getFunilConversao', () => {
  it('taxaConversaoEngajados fica 0 (não NaN) quando ninguém engajou (atendeu/agendou/venda/perdido)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ taxaConversaoEngajados: null }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getFunilConversao(pool, {});

    expect(resultado).toEqual({ taxaConversaoEngajados: 0 });
  });
});

describe('dashboard.model.getTendenciaDiaria', () => {
  it('zero-preenche os 30 dias quando não há nenhum disparo no período (nenhum "buraco" no gráfico)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTendenciaDiaria(pool, {});

    expect(resultado).toHaveLength(30);
    expect(resultado.every((d) => d.total === 0)).toBe(true);
    // ordenado do mais antigo pro mais recente
    expect(new Date(resultado[0].dia).getTime()).toBeLessThan(new Date(resultado[29].dia).getTime());
  });

  it('preenche o total real no dia que teve disparo e mantém os outros 29 em zero', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ dia: hoje, total: 5 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTendenciaDiaria(pool, {});

    expect(resultado).toHaveLength(30);
    const diaDeHoje = resultado.find((d) => d.dia === hoje);
    expect(diaDeHoje.total).toBe(5);
    expect(resultado.filter((d) => d.total === 0)).toHaveLength(29);
  });
});

describe('dashboard.model.getComparativoSemanal', () => {
  it('busca os dois períodos (últimos 7 dias vs 7 anteriores) em paralelo e devolve {atual, anterior}', async () => {
    const pool = criarPoolMockSequencial([
      { recordset: [{ atendeu: 10, agendou: 5, nao_atendeu: 20, venda: 3, perdido: 2 }] }, // atual
      { recordset: [{ atendeu: 8, agendou: 4, nao_atendeu: 22, venda: 1, perdido: 5 }] }, // anterior
    ]);

    const resultado = await getComparativoSemanal(pool, {});

    expect(resultado.atual).toEqual({ atendeu: 10, agendou: 5, nao_atendeu: 20, venda: 3, perdido: 2 });
    expect(resultado.anterior).toEqual({ atendeu: 8, agendou: 4, nao_atendeu: 22, venda: 1, perdido: 5 });
    expect(pool.request).toHaveBeenCalledTimes(2);
  });

  it('devolve taxas 0 nos dois períodos quando não há disparo nenhum (sem NaN)', async () => {
    const linhaVazia = { recordset: [{ atendeu: null, agendou: null, nao_atendeu: null, venda: null, perdido: null }] };
    const pool = criarPoolMockSequencial([linhaVazia, linhaVazia]);

    const resultado = await getComparativoSemanal(pool, {});

    expect(resultado.atual).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 0 });
    expect(resultado.anterior).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 0 });
  });
});

describe('dashboard.model.getTempoMedioPorEtapa', () => {
  it('mapeia status_novo -> status, devolve array vazio quando não há histórico suficiente (nenhuma transição)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTempoMedioPorEtapa(pool, {});

    expect(resultado).toEqual([]);
  });

  it('mapeia status_novo -> status preservando horasMedias', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ status_novo: 'atendeu', horasMedias: 2.5 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTempoMedioPorEtapa(pool, {});

    expect(resultado).toEqual([{ status: 'atendeu', horasMedias: 2.5 }]);
  });
});

describe('dashboard.model.getTempoMedioConversao', () => {
  it('devolve horasMedias=null explícito (não 0) quando ninguém converteu atendeu->venda', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ horasMedias: null }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTempoMedioConversao(pool, {});

    expect(resultado).toEqual({ horasMedias: null });
  });

  it('devolve horasMedias=null quando o recordset vem vazio', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTempoMedioConversao(pool, {});

    expect(resultado).toEqual({ horasMedias: null });
  });

  it('devolve horasMedias numérico quando há conversão', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ horasMedias: 12.3 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTempoMedioConversao(pool, {});

    expect(resultado).toEqual({ horasMedias: 12.3 });
  });
});

describe('dashboard.model.getVelocidadeRespostaAtendente', () => {
  it('devolve array vazio quando nenhum atendente humano tomou ação ainda', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getVelocidadeRespostaAtendente(pool, {});

    expect(resultado).toEqual([]);
  });
});

describe('dashboard.model.getTaxaRecuo', () => {
  it('devolve taxaPct=null explícito quando ninguém no filtro chegou a "agendou"', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ taxaPct: null }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTaxaRecuo(pool, {});

    expect(resultado).toEqual({ taxaPct: null });
  });

  it('devolve taxaPct=null quando o recordset vem vazio', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTaxaRecuo(pool, {});

    expect(resultado).toEqual({ taxaPct: null });
  });

  it('devolve taxaPct numérico quando há gente que agendou e depois perdeu', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ taxaPct: 33.3 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getTaxaRecuo(pool, {});

    expect(resultado).toEqual({ taxaPct: 33.3 });
  });
});

describe('dashboard.model.getCaminhosComuns', () => {
  it('devolve array vazio quando não há nenhuma mudança de status registrada', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getCaminhosComuns(pool, {});

    expect(resultado).toEqual([]);
  });

  it('mapeia caminho/total tal como o banco devolve (top 5, já ordenado)', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [{ caminho: 'atendeu → venda', total: 10 }, { caminho: 'atendeu → perdido', total: 4 }],
    });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getCaminhosComuns(pool, {});

    expect(resultado).toEqual([
      { caminho: 'atendeu → venda', total: 10 },
      { caminho: 'atendeu → perdido', total: 4 },
    ]);
  });
});

describe('dashboard.model.getStatusPulados', () => {
  it('devolve total=0 quando ninguém pulou "agendou" antes de virar venda', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [{ total: 0 }] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getStatusPulados(pool, {});

    expect(resultado).toEqual({ total: 0 });
  });

  it('devolve total=0 quando o recordset vem vazio', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getStatusPulados(pool, {});

    expect(resultado).toEqual({ total: 0 });
  });
});

describe('dashboard.model.getOrigemPorDia', () => {
  it('zero-preenche os 30 dias (sistema=0, atendente=0) quando não há nenhum StatusHistorico no período', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getOrigemPorDia(pool, {});

    expect(resultado).toHaveLength(30);
    expect(resultado.every((d) => d.sistema === 0 && d.atendente === 0)).toBe(true);
  });

  it('pivota origem "sistema"/"atendente" por dia, aceitando Date real ou string do driver', async () => {
    const hoje = new Date().toISOString().slice(0, 10);
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [
        { dia: hoje, origem: 'sistema', total: 3 },
        { dia: hoje, origem: 'atendente', total: 7 },
      ],
    });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getOrigemPorDia(pool, {});

    const diaDeHoje = resultado.find((d) => d.dia === hoje);
    expect(diaDeHoje).toEqual({ dia: hoje, sistema: 3, atendente: 7 });
  });
});

describe('dashboard.model.getMotivosPerdido', () => {
  it('devolve array vazio quando não há nenhum "perdido" com motivo no período', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getMotivosPerdido(pool, {});

    expect(resultado).toEqual([]);
  });

  it('mapeia motivo/total tal como o banco devolve', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [{ motivo: 'preco_condicao', total: 8 }, { motivo: 'outro', total: 2 }],
    });
    const pool = { request: vi.fn(() => request) };

    const resultado = await getMotivosPerdido(pool, {});

    expect(resultado).toEqual([
      { motivo: 'preco_condicao', total: 8 },
      { motivo: 'outro', total: 2 },
    ]);
  });
});

describe('dashboard.model.getDashboard (assemblagem via Promise.all)', () => {
  it('devolve zero disparos / arrays vazios / nulls explícitos em todos os 16 blocos quando não há nenhum dado no período (sem NaN vazando pro JSON)', async () => {
    // getDashboard chama pool.request() 17 vezes na ordem exata do código-fonte (16 blocos +
    // 1 chamada extra dentro de getComparativoSemanal, que dispara 2 getTaxasEmPeriodo em paralelo).
    const respostaVazia = { recordset: [] };
    const respostaTaxasNull = {
      recordset: [{ atendeu: null, agendou: null, nao_atendeu: null, venda: null, perdido: null }],
    };
    const respostas = [
      { recordset: [{ total: 0 }] }, // getTotalDisparos
      respostaTaxasNull, // getTaxas
      respostaVazia, // getDisparosPorRegiao
      respostaVazia, // getStatusGeral
      respostaVazia, // getRankingAtendentes
      { recordset: [{ taxaConversaoEngajados: null }] }, // getFunilConversao
      respostaVazia, // getTendenciaDiaria
      respostaTaxasNull, // getComparativoSemanal -> getTaxasEmPeriodo (atual)
      respostaTaxasNull, // getComparativoSemanal -> getTaxasEmPeriodo (anterior)
      respostaVazia, // getTempoMedioPorEtapa
      { recordset: [{ horasMedias: null }] }, // getTempoMedioConversao
      respostaVazia, // getVelocidadeRespostaAtendente
      { recordset: [{ taxaPct: null }] }, // getTaxaRecuo
      respostaVazia, // getCaminhosComuns
      { recordset: [{ total: 0 }] }, // getStatusPulados
      respostaVazia, // getOrigemPorDia
      respostaVazia, // getMotivosPerdido
    ];
    const pool = criarPoolMockSequencial(respostas);
    getPoolSpy.mockResolvedValue(pool);

    const resultado = await dashboardModel.getDashboard({ estadoId: 999 });

    expect(resultado.totalDisparos).toBe(0);
    expect(resultado.taxas).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 0 });
    expect(resultado.disparosPorRegiao).toEqual([]);
    expect(resultado.statusGeral).toEqual([]);
    expect(resultado.rankingAtendentes).toEqual([]);
    expect(resultado.funilConversao).toEqual({ taxaConversaoEngajados: 0 });
    expect(resultado.tendenciaDiaria).toHaveLength(30);
    expect(resultado.comparativoSemanal.atual).toEqual({ atendeu: 0, agendou: 0, nao_atendeu: 0, venda: 0, perdido: 0 });
    expect(resultado.tempoMedioPorEtapa).toEqual([]);
    expect(resultado.tempoMedioConversao).toEqual({ horasMedias: null });
    expect(resultado.velocidadeRespostaAtendente).toEqual([]);
    expect(resultado.taxaRecuo).toEqual({ taxaPct: null });
    expect(resultado.caminhosComuns).toEqual([]);
    expect(resultado.statusPulados).toEqual({ total: 0 });
    expect(resultado.origemPorDia).toHaveLength(30);
    expect(resultado.motivosPerdido).toEqual([]);

    // Nenhum NaN em lugar nenhum da resposta serializada
    expect(JSON.stringify(resultado)).not.toContain('null "NaN"');
    expect(JSON.stringify(resultado).includes('NaN')).toBe(false);
  });
});

describe('dashboard.model.getAguardandoAcao', () => {
  it('mapeia contato_id/numero_remetente_id para camelCase, devolve array vazio quando não há ninguém pendente', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({ recordset: [] });
    getPoolSpy.mockResolvedValue({ request: vi.fn(() => request) });

    const resultado = await dashboardModel.getAguardandoAcao();

    expect(resultado).toEqual([]);
  });

  it('mapeia os dois tipos ("sem_resposta"/"agendado_parado") preservando a referência de ordenação', async () => {
    const request = criarRequestMock();
    request.query.mockResolvedValue({
      recordset: [
        { contato_id: 1, nome: 'Ana', telefone: '5598900000000', numero_remetente_id: 2, apelido: 'Bruno', referencia: '2026-08-01T00:00:00.000Z', tipo: 'sem_resposta' },
        { contato_id: 3, nome: 'Carlos', telefone: '5598900000001', numero_remetente_id: 4, apelido: 'Dora', referencia: '2026-08-02T00:00:00.000Z', tipo: 'agendado_parado' },
      ],
    });
    getPoolSpy.mockResolvedValue({ request: vi.fn(() => request) });

    const resultado = await dashboardModel.getAguardandoAcao({ horasSemResposta: 48, diasAgendadoParado: 5 });

    expect(request.input).toHaveBeenCalledWith('horasSemResposta', sql.Int, 48);
    expect(request.input).toHaveBeenCalledWith('diasAgendadoParado', sql.Int, 5);
    expect(resultado).toEqual([
      { contatoId: 1, numeroRemetenteId: 2, nome: 'Ana', telefone: '5598900000000', apelido: 'Bruno', referencia: '2026-08-01T00:00:00.000Z', tipo: 'sem_resposta' },
      { contatoId: 3, numeroRemetenteId: 4, nome: 'Carlos', telefone: '5598900000001', apelido: 'Dora', referencia: '2026-08-02T00:00:00.000Z', tipo: 'agendado_parado' },
    ]);
  });
});
