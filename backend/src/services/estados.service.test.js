const estadosModel = require('../models/estados.model');
const estadosService = require('./estados.service');

beforeEach(() => {
  vi.restoreAllMocks();
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

describe('estados.service.listarEstados', () => {
  it('delega direto para o model', async () => {
    estadosModel.listEstadosComDDDs.mockResolvedValue([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'] },
    ]);

    const resultado = await estadosService.listarEstados();

    expect(resultado).toEqual([{ id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'] }]);
  });
});

describe('estados.service.criarEstado', () => {
  it('normaliza nome (trim), uf (trim+uppercase) e ddds (trim) antes de chamar o model', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({ status: 'criado', estado: { id: 7 } });

    await estadosService.criarEstado({ nome: '  Bahia  ', uf: ' ba ', ddds: [' 71 ', '73'] });

    expect(estadosModel.criarEstadoComDDDs).toHaveBeenCalledWith({
      nome: 'Bahia',
      uf: 'BA',
      ddds: ['71', '73'],
    });
  });

  it('deduplica DDDs repetidos no mesmo payload (dedup silenciosa) antes de chamar o model', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({ status: 'criado', estado: { id: 7 } });

    await estadosService.criarEstado({ nome: 'Bahia', uf: 'BA', ddds: ['71', '71', '73', '73', '74'] });

    expect(estadosModel.criarEstadoComDDDs).toHaveBeenCalledWith({
      nome: 'Bahia',
      uf: 'BA',
      ddds: ['71', '73', '74'],
    });
  });

  it('propaga o status "uf_duplicada" retornado pelo model', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({ status: 'uf_duplicada' });

    const resultado = await estadosService.criarEstado({ nome: 'Bahia', uf: 'BA', ddds: ['71'] });

    expect(resultado).toEqual({ status: 'uf_duplicada' });
  });

  it('propaga o status "ddd_duplicado" (com ddd/estadoNome) retornado pelo model', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({
      status: 'ddd_duplicado',
      ddd: '98',
      estadoNome: 'Maranhão',
    });

    const resultado = await estadosService.criarEstado({ nome: 'Novo', uf: 'NE', ddds: ['98'] });

    expect(resultado).toEqual({ status: 'ddd_duplicado', ddd: '98', estadoNome: 'Maranhão' });
  });
});
