const dashboardModel = require('../models/dashboard.model');
const estadosModel = require('../models/estados.model');
const dashboardService = require('./dashboard.service');

beforeEach(() => {
  vi.restoreAllMocks();

  for (const key of Object.keys(dashboardModel)) {
    if (typeof dashboardModel[key] === 'function') {
      vi.spyOn(dashboardModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] dashboard.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }

  for (const key of Object.keys(estadosModel)) {
    if (typeof estadosModel[key] === 'function') {
      vi.spyOn(estadosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] estados.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('dashboard.service.getDashboard', () => {
  it('repassa estadoId/dataInicio/dataFim para o model e devolve o resultado tal como veio', async () => {
    const dashboard = { totalDisparos: 10 };
    dashboardModel.getDashboard.mockResolvedValue(dashboard);

    const resultado = await dashboardService.getDashboard({ estadoId: 6, dataInicio: '2026-08-01', dataFim: '2026-08-31' });

    expect(resultado).toBe(dashboard);
    expect(dashboardModel.getDashboard).toHaveBeenCalledWith({ estadoId: 6, dataInicio: '2026-08-01', dataFim: '2026-08-31' });
  });

  it('funciona sem nenhum filtro (todos undefined)', async () => {
    dashboardModel.getDashboard.mockResolvedValue({});

    await dashboardService.getDashboard();

    expect(dashboardModel.getDashboard).toHaveBeenCalledWith({ estadoId: undefined, dataInicio: undefined, dataFim: undefined });
  });
});

describe('dashboard.service.existeEstado', () => {
  it('delega para estados.model.existeEstado', async () => {
    estadosModel.existeEstado.mockResolvedValue(true);

    const resultado = await dashboardService.existeEstado(6);

    expect(resultado).toBe(true);
    expect(estadosModel.existeEstado).toHaveBeenCalledWith(6);
  });

  it('devolve false quando o estado não existe', async () => {
    estadosModel.existeEstado.mockResolvedValue(false);

    const resultado = await dashboardService.existeEstado(999);

    expect(resultado).toBe(false);
  });
});

describe('dashboard.service.getAguardandoAcao', () => {
  it('delega para o model sem nenhum filtro de período/estado (sempre visão atual)', async () => {
    const itens = [{ contatoId: 1, tipo: 'sem_resposta' }];
    dashboardModel.getAguardandoAcao.mockResolvedValue(itens);

    const resultado = await dashboardService.getAguardandoAcao();

    expect(resultado).toBe(itens);
    expect(dashboardModel.getAguardandoAcao).toHaveBeenCalledWith();
  });
});
