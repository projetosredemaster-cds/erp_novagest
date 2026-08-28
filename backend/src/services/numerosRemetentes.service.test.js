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
      apelido: 'Novo', estadoId: undefined, ativo: undefined, nomeColaboradora: undefined,
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
      apelido: undefined, estadoId: 7, ativo: undefined, nomeColaboradora: undefined,
    });
    expect(resultado).toEqual({ id: 3, apelido: 'CDC Cohatrac', estado: { id: 7 } });
  });

  it('repassa nomeColaboradora (inclusive null explícito) para o model sem transformação', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: 'Ana' })
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: null });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const resultado = await numerosRemetentesService.atualizarNumero(3, { nomeColaboradora: null });

    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined, estadoId: undefined, ativo: undefined, nomeColaboradora: null,
    });
    expect(resultado).toEqual({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: null });
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

describe('numerosRemetentes.service.obterNumeroPorId', () => {
  it('delega direto para o model', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({ id: 3, statusConexao: 'aguardando_conexao' });

    const resultado = await numerosRemetentesService.obterNumeroPorId(3);

    expect(resultado).toEqual({ id: 3, statusConexao: 'aguardando_conexao' });
    expect(numerosRemetentesModel.findNumeroById).toHaveBeenCalledWith(3);
  });
});

describe('numerosRemetentes.service.marcarConectado', () => {
  it('grava numero + status_conexao=conectado e devolve o registro atualizado', async () => {
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      numero: '5598912345678',
      statusConexao: 'conectado',
    });

    const resultado = await numerosRemetentesService.marcarConectado(3, '5598912345678');

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(3, {
      numero: '5598912345678',
      statusConexao: 'conectado',
    });
    expect(resultado).toEqual({ id: 3, numero: '5598912345678', statusConexao: 'conectado' });
  });
});

describe('numerosRemetentes.service.marcarDesconectado', () => {
  it('grava numero=null + status_conexao=aguardando_conexao e devolve o registro atualizado', async () => {
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      numero: null,
      statusConexao: 'aguardando_conexao',
    });

    const resultado = await numerosRemetentesService.marcarDesconectado(3);

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(3, {
      numero: null,
      statusConexao: 'aguardando_conexao',
    });
    expect(resultado).toEqual({ id: 3, numero: null, statusConexao: 'aguardando_conexao' });
  });
});

describe('numerosRemetentes.service.marcarStatusConexao', () => {
  it('grava só o status_conexao, sem mexer no numero', async () => {
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      numero: '5598912345678',
      statusConexao: 'desconectado',
    });

    const resultado = await numerosRemetentesService.marcarStatusConexao(3, 'desconectado');

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(3, { statusConexao: 'desconectado' });
    expect(resultado).toEqual({ id: 3, numero: '5598912345678', statusConexao: 'desconectado' });
  });
});
