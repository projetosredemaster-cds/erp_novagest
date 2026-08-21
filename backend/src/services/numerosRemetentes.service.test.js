const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const numerosRemetentesService = require('./numerosRemetentes.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(numerosRemetentesModel)) {
    if (typeof numerosRemetentesModel[key] === 'function') {
      vi.spyOn(numerosRemetentesModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] numerosRemetentes.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('numerosRemetentes.service.listarNumeros', () => {
  it('delega direto para o model', async () => {
    numerosRemetentesModel.listNumeros.mockResolvedValue([{ id: 3 }]);

    const resultado = await numerosRemetentesService.listarNumeros();

    expect(resultado).toEqual([{ id: 3 }]);
  });
});

describe('numerosRemetentes.service.criarNumero', () => {
  it('retorna "estado_inexistente" sem inserir quando o estado não existe', async () => {
    numerosRemetentesModel.existeEstado.mockResolvedValue(false);

    const resultado = await numerosRemetentesService.criarNumero({ apelido: 'CDC Cohatrac', estadoId: 999 });

    expect(resultado).toBe('estado_inexistente');
    expect(numerosRemetentesModel.insertNumero).not.toHaveBeenCalled();
  });

  it('insere quando o estado existe', async () => {
    numerosRemetentesModel.existeEstado.mockResolvedValue(true);
    numerosRemetentesModel.insertNumero.mockResolvedValue({ id: 3, apelido: 'CDC Cohatrac' });

    const resultado = await numerosRemetentesService.criarNumero({ apelido: 'CDC Cohatrac', estadoId: 6 });

    expect(resultado).toEqual({ id: 3, apelido: 'CDC Cohatrac' });
    expect(numerosRemetentesModel.insertNumero).toHaveBeenCalledWith({ apelido: 'CDC Cohatrac', estadoId: 6 });
  });
});

describe('numerosRemetentes.service.atualizarNumero', () => {
  it('retorna null quando o número não existe (não checa estado nem atualiza)', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue(undefined);

    const resultado = await numerosRemetentesService.atualizarNumero(999, { apelido: 'X' });

    expect(resultado).toBeNull();
    expect(numerosRemetentesModel.existeEstado).not.toHaveBeenCalled();
    expect(numerosRemetentesModel.updateNumero).not.toHaveBeenCalled();
  });

  it('não checa existência de estado quando estadoId não foi enviado (só apelido/ativo mudou)', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'Antigo' })
      .mockResolvedValueOnce({ id: 3, apelido: 'Novo' });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const resultado = await numerosRemetentesService.atualizarNumero(3, { apelido: 'Novo' });

    expect(numerosRemetentesModel.existeEstado).not.toHaveBeenCalled();
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: 'Novo', estadoId: undefined, ativo: undefined,
    });
    expect(resultado).toEqual({ id: 3, apelido: 'Novo' });
  });

  it('retorna "estado_inexistente" quando estadoId enviado não existe, sem atualizar', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({ id: 3, apelido: 'CDC Cohatrac' });
    numerosRemetentesModel.existeEstado.mockResolvedValue(false);

    const resultado = await numerosRemetentesService.atualizarNumero(3, { estadoId: 999 });

    expect(resultado).toBe('estado_inexistente');
    expect(numerosRemetentesModel.updateNumero).not.toHaveBeenCalled();
  });

  it('atualiza e retorna o número atualizado quando estadoId enviado existe', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac' })
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', estado: { id: 7 } });
    numerosRemetentesModel.existeEstado.mockResolvedValue(true);
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const resultado = await numerosRemetentesService.atualizarNumero(3, { estadoId: 7 });

    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined, estadoId: 7, ativo: undefined,
    });
    expect(resultado).toEqual({ id: 3, apelido: 'CDC Cohatrac', estado: { id: 7 } });
  });
});

describe('numerosRemetentes.service.excluirNumero', () => {
  it('delega direto para o model e propaga o status retornado', async () => {
    numerosRemetentesModel.deleteNumeroIfNoVinculos.mockResolvedValue('has_vinculos');

    const resultado = await numerosRemetentesService.excluirNumero(3);

    expect(resultado).toBe('has_vinculos');
    expect(numerosRemetentesModel.deleteNumeroIfNoVinculos).toHaveBeenCalledWith(3);
  });
});
