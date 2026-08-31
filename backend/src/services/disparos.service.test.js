const disparosModel = require('../models/disparos.model');
const disparosEventsService = require('./disparosEvents.service');
const disparosService = require('./disparos.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(disparosModel)) {
    if (typeof disparosModel[key] === 'function') {
      vi.spyOn(disparosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] disparos.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }

  vi.spyOn(disparosEventsService, 'emit').mockImplementation(() => {});
});

describe('disparos.service.listarPainelDisparo', () => {
  it('delega direto para o model', async () => {
    disparosModel.listPainelDisparo.mockResolvedValue([
      { estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 148, numerosAtivos: [] },
    ]);

    const resultado = await disparosService.listarPainelDisparo();

    expect(resultado).toEqual([
      { estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 148, numerosAtivos: [] },
    ]);
  });
});

describe('disparos.service.listarContatosDisponiveis', () => {
  it('normaliza ordem inválida/ausente para "nome_asc"', async () => {
    disparosModel.listContatosDisponiveis.mockResolvedValue([]);

    await disparosService.listarContatosDisponiveis(6, { ordem: 'qualquer-coisa' });

    expect(disparosModel.listContatosDisponiveis).toHaveBeenCalledWith(6, {
      busca: undefined,
      ordem: 'nome_asc',
    });
  });

  it('aceita "nome_desc" e "recentes" como ordens válidas', async () => {
    disparosModel.listContatosDisponiveis.mockResolvedValue([]);

    await disparosService.listarContatosDisponiveis(6, { ordem: 'recentes' });

    expect(disparosModel.listContatosDisponiveis).toHaveBeenCalledWith(6, {
      busca: undefined,
      ordem: 'recentes',
    });
  });

  it('normaliza busca em branco para undefined (não filtra) e faz trim da busca válida', async () => {
    disparosModel.listContatosDisponiveis.mockResolvedValue([]);

    await disparosService.listarContatosDisponiveis(6, { busca: '   ' });
    expect(disparosModel.listContatosDisponiveis).toHaveBeenCalledWith(6, {
      busca: undefined,
      ordem: 'nome_asc',
    });

    await disparosService.listarContatosDisponiveis(6, { busca: '  Maria  ' });
    expect(disparosModel.listContatosDisponiveis).toHaveBeenCalledWith(6, {
      busca: 'Maria',
      ordem: 'nome_asc',
    });
  });
});

describe('disparos.service.verificarDisparo', () => {
  it('deduplica contatoIds repetidos antes de chamar o model', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'ok', avisos: [] });

    await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10, 10, 20],
    });

    expect(disparosModel.verificarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10, 20],
    });
  });

  it('propaga o resultado retornado pelo model (status "ok", com avisos)', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({
      status: 'ok',
      avisos: [{ contatoId: 10, nome: 'Maria', telefone: '5598900000000' }],
    });

    const resultado = await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10],
    });

    expect(resultado).toEqual({
      status: 'ok',
      avisos: [{ contatoId: 10, nome: 'Maria', telefone: '5598900000000' }],
    });
  });

  it('propaga o status "numero_invalido" retornado pelo model', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'numero_invalido' });

    const resultado = await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 999,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_invalido' });
  });

  it('propaga o status "contatos_invalidos" retornado pelo model', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'contatos_invalidos' });

    const resultado = await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [999],
    });

    expect(resultado).toEqual({ status: 'contatos_invalidos' });
  });

  it('propaga o status "numero_desconectado" retornado pelo model', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'numero_desconectado' });

    const resultado = await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_desconectado' });
  });

  it('propaga o status "numero_sem_colaboradora" retornado pelo model', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'numero_sem_colaboradora' });

    const resultado = await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_sem_colaboradora' });
  });

  it('não chama criarDisparo (rota de verificação nunca grava)', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'ok', avisos: [] });

    await disparosService.verificarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10],
    });

    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });
});

describe('disparos.service.criarDisparo', () => {
  it('deduplica contatoIds repetidos antes de chamar o model', async () => {
    disparosModel.criarDisparo.mockResolvedValue({
      status: 'criado',
      disparoId: 1,
      totalContatos: 2,
    });

    await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10, 10, 20],
    });

    expect(disparosModel.criarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10, 20],
    });
  });

  it('propaga o resultado retornado pelo model (status "criado", sem avisos)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({
      status: 'criado',
      disparoId: 42,
      totalContatos: 1,
    });

    const resultado = await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(resultado).toEqual({
      status: 'criado',
      disparoId: 42,
      totalContatos: 1,
    });
  });

  it('propaga o status "numero_invalido" retornado pelo model', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'numero_invalido' });

    const resultado = await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 999,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_invalido' });
  });

  it('propaga o status "contatos_invalidos" retornado pelo model', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'contatos_invalidos' });

    const resultado = await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [999],
    });

    expect(resultado).toEqual({ status: 'contatos_invalidos' });
  });

  it('propaga o status "numero_desconectado" retornado pelo model (nada é gravado)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'numero_desconectado' });

    const resultado = await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_desconectado' });
  });

  it('propaga o status "numero_sem_colaboradora" retornado pelo model (nada é gravado)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'numero_sem_colaboradora' });

    const resultado = await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(resultado).toEqual({ status: 'numero_sem_colaboradora' });
  });

  it('emite "disparo-criado" com o disparoId quando o model retorna status "criado"', async () => {
    disparosModel.criarDisparo.mockResolvedValue({
      status: 'criado',
      disparoId: 42,
      totalContatos: 1,
    });

    await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(disparosEventsService.emit).toHaveBeenCalledTimes(1);
    expect(disparosEventsService.emit).toHaveBeenCalledWith('disparo-criado', { disparoId: 42 });
  });

  it.each([
    'numero_invalido',
    'contatos_invalidos',
    'numero_desconectado',
    'numero_sem_colaboradora',
  ])('não emite "disparo-criado" quando o model retorna status "%s" (nada foi gravado)', async (status) => {
    disparosModel.criarDisparo.mockResolvedValue({ status });

    await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
    });

    expect(disparosEventsService.emit).not.toHaveBeenCalled();
  });
});

describe('disparos.service.detalharDisparo', () => {
  it('delega direto para o model e propaga o resultado', async () => {
    const detalhe = {
      disparoId: 15,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      numeroRemetente: { id: 3, apelido: 'CDC Cohatrac' },
      contatos: [],
    };
    disparosModel.findDisparoDetalhe.mockResolvedValue(detalhe);

    const resultado = await disparosService.detalharDisparo(15);

    expect(disparosModel.findDisparoDetalhe).toHaveBeenCalledWith(15);
    expect(resultado).toEqual(detalhe);
  });

  it('propaga null quando o model não encontra o disparo', async () => {
    disparosModel.findDisparoDetalhe.mockResolvedValue(null);

    const resultado = await disparosService.detalharDisparo(999);

    expect(resultado).toBeNull();
  });
});
