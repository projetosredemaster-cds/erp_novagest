const disparosModel = require('../models/disparos.model');
const disparosEventsService = require('./disparosEvents.service');
const envioDisparosWorker = require('../workers/envioDisparos.worker');
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

  // envioDisparosWorker.processarItemUnico é mockado por padrão para lançar,
  // igual ao guarda de disparosModel acima — nenhum teste deste arquivo deve
  // acionar o worker de verdade (nem, por consequência, baileysSessionService
  // real) sem um mock explícito. Os testes de reenviarContatoFalha que
  // exercitam o caminho de sucesso sobrescrevem isso.
  vi.spyOn(envioDisparosWorker, 'processarItemUnico').mockImplementation(() => {
    throw new Error(
      '[guarda de teste] envioDisparosWorker.processarItemUnico foi chamado sem mock explícito — ' +
      'isso teria acionado o worker real (baileysSessionService/models reais).'
    );
  });
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

describe('disparos.service.criarDisparo — tipoMensagem/diaSemana/horaAgendamento', () => {
  it('repassa tipoMensagem "primeiro_contato" com diaSemana/horaAgendamento ao model sem alteração', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'criado', disparoId: 1, totalContatos: 1 });

    await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
      tipoMensagem: 'primeiro_contato',
      diaSemana: 'Quarta',
      horaAgendamento: '10:15',
    });

    expect(disparosModel.criarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
      tipoMensagem: 'primeiro_contato',
      diaSemana: 'Quarta',
      horaAgendamento: '10:15',
    });
  });

  it('repassa tipoMensagem "reativacao" com diaSemana/horaAgendamento null ao model sem alteração', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'criado', disparoId: 2, totalContatos: 1 });

    await disparosService.criarDisparo({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
      tipoMensagem: 'reativacao',
      diaSemana: null,
      horaAgendamento: null,
    });

    expect(disparosModel.criarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 1,
      contatoIds: [10],
      tipoMensagem: 'reativacao',
      diaSemana: null,
      horaAgendamento: null,
    });
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

describe('disparos.service.listarFalhas', () => {
  it('delega direto para o model e propaga o shape sem transformação', async () => {
    const falhas = [
      {
        disparoContatoId: 42,
        disparoId: 15,
        nome: 'Maria Silva',
        telefone: '5598900000000',
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
        numeroRemetente: { id: 3, apelido: 'CDC Cohatrac' },
        erro: 'Número não possui WhatsApp ativo ou não pôde ser verificado.',
        tentadoEm: null,
        criadoEm: '2026-09-08T14:03:11.000Z',
      },
    ];
    disparosModel.listContatosFalha.mockResolvedValue(falhas);

    const resultado = await disparosService.listarFalhas();

    expect(disparosModel.listContatosFalha).toHaveBeenCalledWith();
    expect(resultado).toEqual(falhas);
  });

  it('propaga array vazio quando não há falhas', async () => {
    disparosModel.listContatosFalha.mockResolvedValue([]);

    const resultado = await disparosService.listarFalhas();

    expect(resultado).toEqual([]);
  });
});

describe('disparos.service.reenviarContatoFalha', () => {
  it('retorna "nao_encontrado" quando o disparoContatoId não existe, sem tentar reativar/processar', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue(null);

    const resultado = await disparosService.reenviarContatoFalha(999);

    expect(resultado).toEqual({ status: 'nao_encontrado' });
    expect(disparosModel.reativarContatoParaReenvio).not.toHaveBeenCalled();
    expect(disparosModel.findItemParaProcessarPorId).not.toHaveBeenCalled();
    expect(envioDisparosWorker.processarItemUnico).not.toHaveBeenCalled();
  });

  it('retorna "nao_falha" quando o item existe mas não está com status "falha", sem tentar reativar/processar', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'enviado' });

    const resultado = await disparosService.reenviarContatoFalha(42);

    expect(resultado).toEqual({ status: 'nao_falha' });
    expect(disparosModel.reativarContatoParaReenvio).not.toHaveBeenCalled();
    expect(envioDisparosWorker.processarItemUnico).not.toHaveBeenCalled();
  });

  it('retorna "conflito" quando o UPDATE condicional não afeta nenhuma linha (corrida perdida para outra requisição)', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.reativarContatoParaReenvio.mockResolvedValue(false);

    const resultado = await disparosService.reenviarContatoFalha(42);

    expect(resultado).toEqual({ status: 'conflito' });
    expect(disparosModel.reativarContatoParaReenvio).toHaveBeenCalledWith(42);
    expect(disparosModel.findItemParaProcessarPorId).not.toHaveBeenCalled();
    expect(envioDisparosWorker.processarItemUnico).not.toHaveBeenCalled();
  });

  it('retorna "nao_encontrado" (caminho de completude) se a releitura pós-UPDATE não encontrar mais o item', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.reativarContatoParaReenvio.mockResolvedValue(true);
    disparosModel.findItemParaProcessarPorId.mockResolvedValue(null);

    const resultado = await disparosService.reenviarContatoFalha(42);

    expect(resultado).toEqual({ status: 'nao_encontrado' });
    expect(envioDisparosWorker.processarItemUnico).not.toHaveBeenCalled();
  });

  it('caminho de sucesso: reativa, processa via envioDisparosWorker.processarItemUnico e devolve o resultado relido', async () => {
    const item = {
      disparoContatoId: 42,
      disparoId: 15,
      numeroRemetenteId: 3,
      contatoId: 100,
      contatoNome: 'Maria Silva',
      contatoTelefone: '5598900000000',
      tipoMensagem: 'reativacao',
      diaSemana: null,
      horaAgendamento: null,
    };
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.reativarContatoParaReenvio.mockResolvedValue(true);
    disparosModel.findItemParaProcessarPorId.mockResolvedValue(item);
    envioDisparosWorker.processarItemUnico.mockResolvedValue({ tentouEnviar: true });
    disparosModel.findResultadoReenvio.mockResolvedValue({
      disparoContatoId: 42,
      status: 'enviado',
      erro: null,
      mensagemEnviada: 'Boa tarde, Maria!',
      enviadoEm: '2026-09-09T18:22:07.000Z',
    });

    const resultado = await disparosService.reenviarContatoFalha(42);

    expect(disparosModel.reativarContatoParaReenvio).toHaveBeenCalledWith(42);
    expect(disparosModel.findItemParaProcessarPorId).toHaveBeenCalledWith(42);
    expect(envioDisparosWorker.processarItemUnico).toHaveBeenCalledWith(item);
    expect(disparosModel.findResultadoReenvio).toHaveBeenCalledWith(42);
    expect(resultado).toEqual({
      status: 'ok',
      contato: {
        disparoContatoId: 42,
        status: 'enviado',
        erro: null,
        mensagemEnviada: 'Boa tarde, Maria!',
        enviadoEm: '2026-09-09T18:22:07.000Z',
      },
    });
  });

  it('caminho de sucesso: o resultado devolvido pode ser um reenvio que falhou de novo (status "falha"), e ainda assim é status "ok" no envelope do service', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.reativarContatoParaReenvio.mockResolvedValue(true);
    disparosModel.findItemParaProcessarPorId.mockResolvedValue({ disparoContatoId: 42 });
    envioDisparosWorker.processarItemUnico.mockResolvedValue({ tentouEnviar: false });
    disparosModel.findResultadoReenvio.mockResolvedValue({
      disparoContatoId: 42,
      status: 'falha',
      erro: 'Número não está conectado.',
      mensagemEnviada: null,
      enviadoEm: null,
    });

    const resultado = await disparosService.reenviarContatoFalha(42);

    expect(resultado).toEqual({
      status: 'ok',
      contato: {
        disparoContatoId: 42,
        status: 'falha',
        erro: 'Número não está conectado.',
        mensagemEnviada: null,
        enviadoEm: null,
      },
    });
  });

  // Teste-chave do pedido original: prova que o reenvio manual NUNCA checa
  // horário comercial, mesmo fora da janela (estaDentroDoHorarioComercial só
  // existe dentro de processarCicloEnvio, que este caminho nunca chama — ver
  // decisão de design documentada em disparos.service.js e no contrato v12).
  // Se algum dia alguém adicionar essa checagem em reenviarContatoFalha por
  // engano, este teste tem que quebrar.
  it.each([
    // Domingo às 3h da manhã (fim de semana E fora do horário comercial)
    ['domingo de madrugada', new Date('2026-09-06T03:00:00Z')],
    // Terça-feira às 3h da manhã (dia útil, mas fora do horário comercial)
    ['dia útil de madrugada', new Date('2026-09-01T03:00:00Z')],
  ])('ignora horário comercial — processarItemUnico é chamado mesmo às 3h da manhã (%s)', async (_descricao, agora) => {
    vi.useFakeTimers();
    vi.setSystemTime(agora);
    try {
      const item = { disparoContatoId: 42, numeroRemetenteId: 3 };
      disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
      disparosModel.reativarContatoParaReenvio.mockResolvedValue(true);
      disparosModel.findItemParaProcessarPorId.mockResolvedValue(item);
      envioDisparosWorker.processarItemUnico.mockResolvedValue({ tentouEnviar: true });
      disparosModel.findResultadoReenvio.mockResolvedValue({
        disparoContatoId: 42,
        status: 'enviado',
        erro: null,
        mensagemEnviada: 'Boa tarde, Maria!',
        enviadoEm: agora.toISOString(),
      });

      const resultado = await disparosService.reenviarContatoFalha(42);

      expect(envioDisparosWorker.processarItemUnico).toHaveBeenCalledTimes(1);
      expect(envioDisparosWorker.processarItemUnico).toHaveBeenCalledWith(item);
      expect(resultado.status).toBe('ok');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('disparos.service.ignorarContatoFalha', () => {
  it('retorna "nao_encontrado" quando o disparoContatoId não existe, sem tentar ignorar', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue(null);

    const resultado = await disparosService.ignorarContatoFalha(999);

    expect(resultado).toEqual({ status: 'nao_encontrado' });
    expect(disparosModel.ignorarContatoFalha).not.toHaveBeenCalled();
  });

  it('retorna "nao_falha" quando o item existe mas não está com status "falha", sem tentar ignorar', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'enviado' });

    const resultado = await disparosService.ignorarContatoFalha(42);

    expect(resultado).toEqual({ status: 'nao_falha' });
    expect(disparosModel.ignorarContatoFalha).not.toHaveBeenCalled();
  });

  it('retorna "conflito" quando o UPDATE condicional não afeta nenhuma linha (corrida perdida para outra requisição)', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.ignorarContatoFalha.mockResolvedValue(false);

    const resultado = await disparosService.ignorarContatoFalha(42);

    expect(resultado).toEqual({ status: 'conflito' });
    expect(disparosModel.ignorarContatoFalha).toHaveBeenCalledWith(42);
  });

  it('retorna "ok" quando o model confirma o UPDATE condicional (caminho de sucesso)', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.ignorarContatoFalha.mockResolvedValue(true);

    const resultado = await disparosService.ignorarContatoFalha(42);

    expect(resultado).toEqual({ status: 'ok' });
    expect(disparosModel.ignorarContatoFalha).toHaveBeenCalledWith(42);
  });

  // Diferente de reenviarContatoFalha, ignorar não tem processamento posterior
  // nenhum — só o UPDATE condicional. Confirma que nenhum caminho aciona o
  // worker de envio (nem findItemParaProcessarPorId/findResultadoReenvio,
  // que só fazem sentido no fluxo de reenvio).
  it('nunca chama o worker de envio nem funções exclusivas do fluxo de reenvio, em nenhum branch', async () => {
    disparosModel.findDisparoContatoById.mockResolvedValue({ id: 42, status: 'falha' });
    disparosModel.ignorarContatoFalha.mockResolvedValue(true);

    await disparosService.ignorarContatoFalha(42);

    expect(envioDisparosWorker.processarItemUnico).not.toHaveBeenCalled();
    expect(disparosModel.findItemParaProcessarPorId).not.toHaveBeenCalled();
    expect(disparosModel.findResultadoReenvio).not.toHaveBeenCalled();
    expect(disparosModel.reativarContatoParaReenvio).not.toHaveBeenCalled();
  });
});
