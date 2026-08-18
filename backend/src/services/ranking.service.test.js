const rankingModel = require('../models/ranking.model');
const rankingService = require('./ranking.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(rankingModel)) {
    if (typeof rankingModel[key] === 'function') {
      vi.spyOn(rankingModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] ranking.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('ranking.service.salvarEntrada', () => {
  it('repassa redeId (renomeado de lojaId) ao model.upsertEntrada', async () => {
    rankingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 101, data_ref: '2026-07-17', categoria_id: 1, rede_id: 5, valor: 100, atualizado_em: '2026-07-17',
    });

    const resultado = await rankingService.salvarEntrada({ data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 100 });

    expect(rankingModel.upsertEntrada).toHaveBeenCalledWith({ data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 100 });
    expect(resultado.rede_id).toBe(5);
  });
});
