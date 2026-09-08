process.env.TZ = 'UTC';
process.env.ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS = '0';
process.env.ENVIO_DISPAROS_LOTE_TAMANHO = '5';

const disparosModel = require('../models/disparos.model');
const mensagensTemplatesModel = require('../models/mensagensTemplates.model');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');
const disparosEventsService = require('../services/disparosEvents.service');
const worker = require('./envioDisparos.worker');

const {
  processarCicloEnvio,
  iniciarWorkerEnvioDisparos,
  pararWorkerEnvioDisparos,
  _calcularProximoTemplate,
  _montarMensagem,
  _estaDentroDoHorarioComercial,
  _calcularSaudacao,
} = worker;

function itemPendente(overrides = {}) {
  return {
    disparoContatoId: 1,
    disparoId: 10,
    numeroRemetenteId: 3,
    contatoId: 100,
    contatoNome: 'Maria Silva',
    contatoTelefone: '5598900000000',
    ...overrides,
  };
}

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

  for (const key of Object.keys(mensagensTemplatesModel)) {
    if (typeof mensagensTemplatesModel[key] === 'function') {
      vi.spyOn(mensagensTemplatesModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] mensagensTemplates.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }

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

  for (const key of Object.keys(mensagensModel)) {
    if (typeof mensagensModel[key] === 'function') {
      vi.spyOn(mensagensModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] mensagens.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }

  vi.spyOn(baileysSessionService, 'getStatusEmMemoria').mockReturnValue(null);
  vi.spyOn(baileysSessionService, 'obterSocketConectado').mockReturnValue(null);

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-01T15:00:00Z'));
});

afterEach(() => {
  pararWorkerEnvioDisparos();
  vi.useRealTimers();
});

describe('envioDisparos.worker._calcularProximoTemplate', () => {
  const templates = [
    { id: 1, corpo: 'Oi {nomeColaboradora} 1', ordem: 1 },
    { id: 2, corpo: 'Oi {nomeColaboradora} 2', ordem: 2 },
    { id: 3, corpo: 'Oi {nomeColaboradora} 3', ordem: 3 },
  ];

  it('começa do primeiro quando ultimoTemplateUsadoId é null', () => {
    expect(_calcularProximoTemplate(templates, null)).toEqual(templates[0]);
  });

  it('começa do primeiro quando ultimoTemplateUsadoId não bate com nenhum template ativo', () => {
    expect(_calcularProximoTemplate(templates, 999)).toEqual(templates[0]);
  });

  it('avança para o próximo da lista em ordem', () => {
    expect(_calcularProximoTemplate(templates, 1)).toEqual(templates[1]);
    expect(_calcularProximoTemplate(templates, 2)).toEqual(templates[2]);
  });

  it('cicla de volta ao primeiro depois do último ativo', () => {
    expect(_calcularProximoTemplate(templates, 3)).toEqual(templates[0]);
  });

  it('retorna null quando não há nenhum template ativo', () => {
    expect(_calcularProximoTemplate([], 1)).toBeNull();
    expect(_calcularProximoTemplate(null, 1)).toBeNull();
  });
});

describe('envioDisparos.worker._montarMensagem', () => {
  it('substitui todas as ocorrências de {nomeColaboradora}', () => {
    const resultado = _montarMensagem('Oi {nomeColaboradora}, aqui é a {nomeColaboradora}!', 'Ana');
    expect(resultado).toBe('Oi Ana, aqui é a Ana!');
  });

  it('substitui {diaSemana} e {horaSemana} quando o 3º parâmetro (extras) é informado', () => {
    const resultado = _montarMensagem(
      'Oi {nomeColaboradora}, te aguardamos {diaSemana} às {horaSemana}.',
      'Ana',
      { diaSemana: 'Quarta', horaSemana: '14:30' }
    );
    expect(resultado).toBe('Oi Ana, te aguardamos Quarta às 14:30.');
  });

  it('não altera {diaSemana}/{horaSemana} quando extras não é informado (placeholders ficam literais no corpo)', () => {
    const resultado = _montarMensagem('Oi {nomeColaboradora}, {diaSemana} às {horaSemana}.', 'Ana');
    expect(resultado).toBe('Oi Ana, {diaSemana} às {horaSemana}.');
  });

  it('não altera {diaSemana}/{horaSemana} quando extras é informado mas com os dois campos null', () => {
    const resultado = _montarMensagem(
      'Oi {nomeColaboradora}, {diaSemana} às {horaSemana}.',
      'Ana',
      { diaSemana: null, horaSemana: null }
    );
    expect(resultado).toBe('Oi Ana, {diaSemana} às {horaSemana}.');
  });
});

describe('envioDisparos.worker._estaDentroDoHorarioComercial (defaults 11h-22h UTC = 8h-19h Brasília)', () => {
  it('true numa terça-feira dentro da janela (15h)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-01T15:00:00Z'))).toBe(true);
  });

  it('false numa terça-feira antes da janela (10h)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-01T10:00:00Z'))).toBe(false);
  });

  it('false numa terça-feira exatamente no limite superior (22h, exclusivo)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-01T22:00:00Z'))).toBe(false);
  });

  it('true numa terça-feira exatamente no limite inferior (11h, inclusivo)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-01T11:00:00Z'))).toBe(true);
  });

  it('false num sábado dentro do horário (15h)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-05T15:00:00Z'))).toBe(false);
  });

  it('false num domingo dentro do horário (15h)', () => {
    expect(_estaDentroDoHorarioComercial(new Date('2026-09-06T15:00:00Z'))).toBe(false);
  });
});

describe('envioDisparos.worker._calcularSaudacao (limites 8h-15h-21h UTC = 5h-12h-18h Brasília)', () => {
  it('regressão do bug de produção: 19h03 UTC (16h03 Brasília) é "Boa tarde", não "Boa noite"', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 19, 3)))).toBe('Boa tarde');
  });

  it('8h UTC (5h Brasília) é o início de "Bom dia" (inclusivo)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 8, 0)))).toBe('Bom dia');
  });

  it('14h59 UTC ainda é "Bom dia" (limite superior exclusivo em 15h)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 14, 59)))).toBe('Bom dia');
  });

  it('15h UTC (12h Brasília) é o início de "Boa tarde" (inclusivo)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 15, 0)))).toBe('Boa tarde');
  });

  it('20h59 UTC ainda é "Boa tarde" (limite superior exclusivo em 21h)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 20, 59)))).toBe('Boa tarde');
  });

  it('21h UTC (18h Brasília) já é "Boa noite" (fronteira tarde→noite)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 21, 0)))).toBe('Boa noite');
  });

  it('madrugada (2h/3h UTC) continua "Boa noite" (faixa cruza meia-noite)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 2, 0)))).toBe('Boa noite');
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 3, 0)))).toBe('Boa noite');
  });

  it('7h59 UTC ainda é "Boa noite" (limite inferior de "Bom dia" é 8h exclusivo abaixo)', () => {
    expect(_calcularSaudacao(new Date(Date.UTC(2026, 8, 8, 7, 59)))).toBe('Boa noite');
  });
});

describe('envioDisparos.worker.processarCicloEnvio', () => {
  it('não consulta o banco fora do horário comercial (ex.: sábado)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T15:00:00Z'));

    await processarCicloEnvio();

    expect(disparosModel.listContatosPendentesParaEnvio).not.toHaveBeenCalled();
  });

  it('não faz nada quando não há itens pendentes', async () => {
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([]);

    await processarCicloEnvio();

    expect(disparosModel.marcarContatoFalha).not.toHaveBeenCalled();
    expect(disparosModel.marcarContatoEnviado).not.toHaveBeenCalled();
  });

  it('não derruba o ciclo se a busca do lote falhar', async () => {
    disparosModel.listContatosPendentesParaEnvio.mockRejectedValue(new Error('boom'));

    await expect(processarCicloEnvio()).resolves.toBeUndefined();
  });

  it('lote misto: sem sessão conectada, sem nome_colaboradora, sucesso, e falha no envio', async () => {
    const itemSemSessao = itemPendente({ disparoContatoId: 1, numeroRemetenteId: 1 });
    const itemSemColaboradora = itemPendente({ disparoContatoId: 2, numeroRemetenteId: 2 });
    const itemSucesso = itemPendente({ disparoContatoId: 3, numeroRemetenteId: 3, contatoTelefone: '5598900000000' });
    const itemFalhaEnvio = itemPendente({ disparoContatoId: 4, numeroRemetenteId: 4, contatoTelefone: '5598900000004' });

    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([
      itemSemSessao,
      itemSemColaboradora,
      itemSucesso,
      itemFalhaEnvio,
    ]);
    disparosModel.marcarContatoFalha.mockResolvedValue(undefined);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    const templatesAtivos = [
      { id: 10, corpo: 'Olá {nomeColaboradora}!', ordem: 1 },
      { id: 20, corpo: 'E aí {nomeColaboradora}!', ordem: 2 },
    ];
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue(templatesAtivos);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(10);

    const sendMessage = vi.fn().mockImplementation(async (jid) => {
      if (jid.startsWith('5598900000000')) return undefined; // sucesso
      throw new Error('timeout de rede');
    });
    const onWhatsApp = vi.fn().mockImplementation(async (telefone) => [
      { jid: `${telefone}@s.whatsapp.net`, exists: true },
    ]);
    const sockFalso = { sendMessage, onWhatsApp };

    baileysSessionService.getStatusEmMemoria.mockImplementation((numeroRemetenteId) => {
      if (numeroRemetenteId === 1) return null; // desconectado
      return 'conectado';
    });
    baileysSessionService.obterSocketConectado.mockImplementation((numeroRemetenteId) => {
      if (numeroRemetenteId === 1) return null;
      return sockFalso;
    });

    numerosRemetentesModel.findNomeColaboradoraById.mockImplementation(async (numeroRemetenteId) => {
      if (numeroRemetenteId === 2) return null; // sem colaboradora
      return 'Ana';
    });

    const cicloPromise = processarCicloEnvio();
    await vi.advanceTimersByTimeAsync(10000);
    await cicloPromise;

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(1, 'Número não está conectado.');

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(2, 'Número sem nome de colaboradora configurado.');

    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledTimes(1);
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: 3,
      templateUsadoId: 20, // próximo depois do id=10
      mensagemEnviada: 'E aí Ana!',
      tipoMensagem: 'reativacao',
    });

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(4, 'timeout de rede');

    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledTimes(1);

    expect(mensagensTemplatesModel.listTemplatesAtivosOrdenados).toHaveBeenCalledTimes(2); // só itens 3 e 4
  });

  it('nenhum template ativo → todos os pendentes elegíveis viram falha com a mensagem certa', async () => {
    const item = itemPendente();
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoFalha.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');

    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    await processarCicloEnvio();

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(
      item.disparoContatoId,
      'Nenhum template de mensagem ativo cadastrado.'
    );
    expect(disparosModel.marcarContatoEnviado).not.toHaveBeenCalled();
    expect(baileysSessionService.obterSocketConectado).not.toHaveBeenCalled();
  });

  it('rotação cicla de volta ao primeiro template depois do último ativo', async () => {
    const item = itemPendente();
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');

    const templatesAtivos = [
      { id: 10, corpo: 'Template 1 {nomeColaboradora}', ordem: 1 },
      { id: 20, corpo: 'Template 2 {nomeColaboradora}', ordem: 2 },
    ];
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue(templatesAtivos);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(20); // último da lista

    const sock = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onWhatsApp: vi.fn().mockImplementation(async (telefone) => [
        { jid: `${telefone}@s.whatsapp.net`, exists: true },
      ]),
    };
    baileysSessionService.obterSocketConectado.mockReturnValue(sock);

    await processarCicloEnvio();

    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: item.disparoContatoId,
      templateUsadoId: 10,
      mensagemEnviada: 'Template 1 Ana',
      tipoMensagem: 'reativacao',
    });
  });

  it('usa o jid confirmado por sock.onWhatsApp ao chamar sock.sendMessage', async () => {
    const item = itemPendente({ contatoTelefone: '5511988887777' });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockResolvedValue([
      { jid: '5511988887777@s.whatsapp.net', exists: true },
    ]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(onWhatsApp).toHaveBeenCalledWith('5511988887777');
    expect(sendMessage).toHaveBeenCalledWith('5511988887777@s.whatsapp.net', { text: 'Oi Ana' });
  });

  it('não envia e marca falha quando sock.onWhatsApp não encontra o número (sem WhatsApp ativo)', async () => {
    const item = itemPendente({ contatoTelefone: '5511988887777' });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoFalha.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn();
    const onWhatsApp = vi.fn().mockResolvedValue([]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(
      item.disparoContatoId,
      'Número não possui WhatsApp ativo ou não pôde ser verificado.'
    );
    expect(sendMessage).not.toHaveBeenCalled();
    expect(disparosModel.marcarContatoEnviado).not.toHaveBeenCalled();
  });

  it('usa o jid retornado por sock.onWhatsApp mesmo quando difere do telefone concatenado', async () => {
    const item = itemPendente({ contatoTelefone: '5511988887777' });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const jidResolvido = '551188887777@s.whatsapp.net';
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: jidResolvido, exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(sendMessage).toHaveBeenCalledWith(jidResolvido, { text: 'Oi Ana' });
    expect(sendMessage).not.toHaveBeenCalledWith('5511988887777@s.whatsapp.net', expect.anything());
  });

  it('registra a mensagem enviada em Mensagens (remetente=ia) após um envio bem-sucedido', async () => {
    const item = itemPendente({ contatoId: 777, contatoTelefone: '5511988887777' });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);
    mensagensModel.inserirMensagemEnviada.mockResolvedValue({ id: 1 });

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue({ key: { id: 'ALGUM_ID' } });
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '5511988887777@s.whatsapp.net', exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(mensagensModel.inserirMensagemEnviada).toHaveBeenCalledWith({
      contatoId: 777,
      numeroRemetenteId: item.numeroRemetenteId,
      remetente: 'ia',
      corpo: 'Oi Ana',
      baileysMessageId: 'ALGUM_ID',
      statusEntrega: 'pendente',
    });
  });

  it('falha ao registrar em Mensagens não derruba o ciclo nem desfaz o envio já confirmado', async () => {
    const item = itemPendente();
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);
    mensagensModel.inserirMensagemEnviada.mockRejectedValue(new Error('falha ao gravar Mensagens'));

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: `${item.contatoTelefone}@s.whatsapp.net`, exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await expect(processarCicloEnvio()).resolves.toBeUndefined();

    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledTimes(1);
    expect(disparosModel.marcarContatoFalha).not.toHaveBeenCalled();
  });

  it('marca falha (sem tentar enviar) quando sock.onWhatsApp lança erro inesperado', async () => {
    const item = itemPendente({ contatoTelefone: '5511988887777' });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoFalha.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn();
    const onWhatsApp = vi.fn().mockRejectedValue(new Error('conexão instável'));
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(item.disparoContatoId, 'conexão instável');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(disparosModel.marcarContatoEnviado).not.toHaveBeenCalled();
  });

  it('tipoMensagem="primeiro_contato": consulta os templates/ponteiro do tipo certo e substitui {diaSemana}/{horaSemana} na mensagem enviada de fato', async () => {
    const item = itemPendente({
      tipoMensagem: 'primeiro_contato',
      diaSemana: 'Sexta',
      horaAgendamento: '09:00',
    });
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}, agende para {diaSemana} às {horaSemana}.', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockImplementation(async (telefone) => [
      { jid: `${telefone}@s.whatsapp.net`, exists: true },
    ]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(mensagensTemplatesModel.listTemplatesAtivosOrdenados).toHaveBeenCalledWith('primeiro_contato');
    expect(mensagensTemplatesModel.getUltimoTemplateUsadoId).toHaveBeenCalledWith('primeiro_contato');
    expect(sendMessage).toHaveBeenCalledWith(
      `${item.contatoTelefone}@s.whatsapp.net`,
      { text: 'Oi Ana, agende para Sexta às 09:00.' }
    );
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: item.disparoContatoId,
      templateUsadoId: 1,
      mensagemEnviada: 'Oi Ana, agende para Sexta às 09:00.',
      tipoMensagem: 'primeiro_contato',
    });
  });

  it('tipoMensagem="reativacao" (default do item): consulta os templates do tipo certo e NÃO substitui {diaSemana}/{horaSemana} mesmo que o template os contenha', async () => {
    const item = itemPendente(); // sem tipoMensagem no item -> default 'reativacao' dentro do worker
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([item]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');
    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockResolvedValue([
      { id: 1, corpo: 'Oi {nomeColaboradora}, {diaSemana} às {horaSemana}.', ordem: 1 },
    ]);
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockResolvedValue(null);

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockImplementation(async (telefone) => [
      { jid: `${telefone}@s.whatsapp.net`, exists: true },
    ]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(mensagensTemplatesModel.listTemplatesAtivosOrdenados).toHaveBeenCalledWith('reativacao');
    expect(mensagensTemplatesModel.getUltimoTemplateUsadoId).toHaveBeenCalledWith('reativacao');
    expect(sendMessage).toHaveBeenCalledWith(
      `${item.contatoTelefone}@s.whatsapp.net`,
      { text: 'Oi Ana, {diaSemana} às {horaSemana}.' }
    );
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: item.disparoContatoId,
      templateUsadoId: 1,
      mensagemEnviada: 'Oi Ana, {diaSemana} às {horaSemana}.',
      tipoMensagem: 'reativacao',
    });
  });

  it('rotação de templates é independente por tipo: dois itens de tipos diferentes no mesmo lote não compartilham nem atropelam o ponteiro um do outro', async () => {
    const itemReativacao = itemPendente({
      disparoContatoId: 1,
      numeroRemetenteId: 1,
      contatoTelefone: '5598900000001',
      tipoMensagem: 'reativacao',
    });
    const itemPrimeiroContato = itemPendente({
      disparoContatoId: 2,
      numeroRemetenteId: 2,
      contatoTelefone: '5598900000002',
      tipoMensagem: 'primeiro_contato',
      diaSemana: 'Terça',
      horaAgendamento: '11:00',
    });

    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([itemReativacao, itemPrimeiroContato]);
    disparosModel.marcarContatoEnviado.mockResolvedValue(undefined);

    baileysSessionService.getStatusEmMemoria.mockReturnValue('conectado');
    numerosRemetentesModel.findNomeColaboradoraById.mockResolvedValue('Ana');

    const templatesReativacao = [
      { id: 100, corpo: 'Reativação A {nomeColaboradora}', ordem: 1 },
      { id: 101, corpo: 'Reativação B {nomeColaboradora}', ordem: 2 },
    ];
    const templatesPrimeiroContato = [
      { id: 200, corpo: 'Primeiro contato A {nomeColaboradora} {diaSemana} {horaSemana}', ordem: 1 },
      { id: 201, corpo: 'Primeiro contato B {nomeColaboradora} {diaSemana} {horaSemana}', ordem: 2 },
    ];

    mensagensTemplatesModel.listTemplatesAtivosOrdenados.mockImplementation(async (tipo) => (
      tipo === 'primeiro_contato' ? templatesPrimeiroContato : templatesReativacao
    ));
    mensagensTemplatesModel.getUltimoTemplateUsadoId.mockImplementation(async (tipo) => (
      // reativação já tinha usado o último (id 101) -> deve ciclar pro primeiro (id 100)
      // primeiro_contato nunca usou nenhum (null) -> deve começar pelo primeiro (id 200)
      tipo === 'primeiro_contato' ? null : 101
    ));

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockImplementation(async (telefone) => [
      { jid: `${telefone}@s.whatsapp.net`, exists: true },
    ]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    // ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS='0' no topo do arquivo vira 4000ms de fato dentro do worker
    // (o "0 || 4000" do código-fonte trata "0" como falsy) — mesmo padrão de advanceTimersByTimeAsync
    // já usado no teste "lote misto" acima para não travar entre o 1º e o 2º item do lote.
    const cicloPromise = processarCicloEnvio();
    await vi.advanceTimersByTimeAsync(10000);
    await cicloPromise;

    expect(mensagensTemplatesModel.listTemplatesAtivosOrdenados).toHaveBeenCalledWith('reativacao');
    expect(mensagensTemplatesModel.listTemplatesAtivosOrdenados).toHaveBeenCalledWith('primeiro_contato');
    expect(mensagensTemplatesModel.getUltimoTemplateUsadoId).toHaveBeenCalledWith('reativacao');
    expect(mensagensTemplatesModel.getUltimoTemplateUsadoId).toHaveBeenCalledWith('primeiro_contato');

    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: 1,
      templateUsadoId: 100, // ciclou de volta ao primeiro da lista de reativação — não avançou pra 201/200
      mensagemEnviada: 'Reativação A Ana',
      tipoMensagem: 'reativacao',
    });
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: 2,
      templateUsadoId: 200, // começou do primeiro da lista de primeiro_contato (nunca usado) — não herdou o 101 da reativação
      mensagemEnviada: 'Primeiro contato A Ana Terça 11:00',
      tipoMensagem: 'primeiro_contato',
    });
  });
});

describe('envioDisparos.worker: disparo por evento ("disparo-criado")', () => {
  it('emitir "disparo-criado" dispara um ciclo imediatamente (dentro do horário comercial fixado no beforeEach)', async () => {
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([]);

    iniciarWorkerEnvioDisparos();
    disparosEventsService.emit('disparo-criado', { disparoId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(disparosModel.listContatosPendentesParaEnvio).toHaveBeenCalledTimes(1);
  });

  it('ignora um novo evento enquanto um ciclo já está em andamento (nunca roda em paralelo)', async () => {
    let resolveLote;
    disparosModel.listContatosPendentesParaEnvio.mockImplementation(
      () => new Promise((resolve) => { resolveLote = resolve; })
    );

    iniciarWorkerEnvioDisparos();
    disparosEventsService.emit('disparo-criado', { disparoId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    disparosEventsService.emit('disparo-criado', { disparoId: 2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(disparosModel.listContatosPendentesParaEnvio).toHaveBeenCalledTimes(1);

    resolveLote([]);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('depois de pararWorkerEnvioDisparos, emitir o evento não dispara mais nenhum ciclo', async () => {
    disparosModel.listContatosPendentesParaEnvio.mockResolvedValue([]);

    iniciarWorkerEnvioDisparos();
    pararWorkerEnvioDisparos();
    disparosEventsService.emit('disparo-criado', { disparoId: 1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(disparosModel.listContatosPendentesParaEnvio).not.toHaveBeenCalled();
  });
});
