
const respostasRapidasModel = require('../models/respostasRapidas.model');
const respostasRapidasService = require('./respostasRapidas.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(respostasRapidasModel)) {
    if (typeof respostasRapidasModel[key] === 'function') {
      vi.spyOn(respostasRapidasModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] respostasRapidas.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('respostasRapidas.service.listarRespostas', () => {
  it('delega direto para o model', async () => {
    respostasRapidasModel.listAtivas.mockResolvedValue([{ id: 1, titulo: 'Saudação' }]);

    const resultado = await respostasRapidasService.listarRespostas();

    expect(resultado).toEqual([{ id: 1, titulo: 'Saudação' }]);
  });
});

describe('respostasRapidas.service.criarResposta', () => {
  it('delega direto para o model.insertResposta com os campos recebidos', async () => {
    respostasRapidasModel.insertResposta.mockResolvedValue({ id: 5, titulo: 'Saudação', corpo: 'Olá', ordem: 0 });

    const resultado = await respostasRapidasService.criarResposta({ titulo: 'Saudação', corpo: 'Olá', ordem: 0 });

    expect(resultado).toEqual({ id: 5, titulo: 'Saudação', corpo: 'Olá', ordem: 0 });
    expect(respostasRapidasModel.insertResposta).toHaveBeenCalledWith({ titulo: 'Saudação', corpo: 'Olá', ordem: 0 });
  });
});

describe('respostasRapidas.service.atualizarResposta', () => {
  it('retorna null quando a resposta não existe (não chama updateResposta)', async () => {
    respostasRapidasModel.findById.mockResolvedValue(undefined);

    const resultado = await respostasRapidasService.atualizarResposta(999, { titulo: 'Novo' });

    expect(resultado).toBeNull();
    expect(respostasRapidasModel.updateResposta).not.toHaveBeenCalled();
  });

  it('atualiza e retorna o registro já atualizado quando a resposta existe', async () => {
    respostasRapidasModel.findById
      .mockResolvedValueOnce({ id: 1, titulo: 'Antigo', corpo: 'Olá', ordem: 0, ativo: true })
      .mockResolvedValueOnce({ id: 1, titulo: 'Novo', corpo: 'Olá', ordem: 0, ativo: true });
    respostasRapidasModel.updateResposta.mockResolvedValue(undefined);

    const resultado = await respostasRapidasService.atualizarResposta(1, { titulo: 'Novo' });

    expect(respostasRapidasModel.updateResposta).toHaveBeenCalledWith(1, {
      titulo: 'Novo', corpo: undefined, ordem: undefined, ativo: undefined,
    });
    expect(resultado).toEqual({ id: 1, titulo: 'Novo', corpo: 'Olá', ordem: 0, ativo: true });
  });
});

describe('respostasRapidas.service.excluirResposta', () => {
  it('retorna "not_found" quando a resposta não existe (não chama deleteResposta)', async () => {
    respostasRapidasModel.findById.mockResolvedValue(undefined);

    const resultado = await respostasRapidasService.excluirResposta(999);

    expect(resultado).toBe('not_found');
    expect(respostasRapidasModel.deleteResposta).not.toHaveBeenCalled();
  });

  it('retorna "deleted" e chama deleteResposta quando a resposta existe', async () => {
    respostasRapidasModel.findById.mockResolvedValue({ id: 1, titulo: 'Saudação' });
    respostasRapidasModel.deleteResposta.mockResolvedValue(true);

    const resultado = await respostasRapidasService.excluirResposta(1);

    expect(resultado).toBe('deleted');
    expect(respostasRapidasModel.deleteResposta).toHaveBeenCalledWith(1);
  });
});
