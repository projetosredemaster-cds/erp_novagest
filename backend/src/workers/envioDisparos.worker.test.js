// Mesmo padrão de guarda usado no resto da suíte (ex.: disparos.service.test.js):
// todo model é "guardado" por padrão, lançando se alguma função for chamada
// sem mock explícito — isso teria tentado uma conexão real com o Azure SQL.
// `baileysSessionService` não é model (não fala com o banco), então não
// recebe a mesma guarda — só as duas funções que o worker realmente usa
// (`getStatusEmMemoria`/`obterSocketConectado`) são espiadas/mockadas
// diretamente em cada teste. O delay entre mensagens é zerado via env var
// ANTES do require do worker (lido uma única vez, no topo do módulo) para
// os testes não dependerem de tempo real.
process.env.ENVIO_DISPAROS_DELAY_ENTRE_MENSAGENS_MS = '0';
process.env.ENVIO_DISPAROS_LOTE_TAMANHO = '5';

const disparosModel = require('../models/disparos.model');
const mensagensTemplatesModel = require('../models/mensagensTemplates.model');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const baileysSessionService = require('../services/baileysSession.service');
const worker = require('./envioDisparos.worker');

const { processarCicloEnvio, _calcularProximoTemplate, _montarMensagem } = worker;

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

  vi.spyOn(baileysSessionService, 'getStatusEmMemoria').mockReturnValue(null);
  vi.spyOn(baileysSessionService, 'obterSocketConectado').mockReturnValue(null);

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
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
});

describe('envioDisparos.worker.processarCicloEnvio', () => {
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

    await processarCicloEnvio();

    // item 1: sem sessão conectada — falha sem tentar template
    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(1, 'Número não está conectado.');

    // item 2: sem nome_colaboradora — falha sem tentar template
    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(2, 'Número sem nome de colaboradora configurado.');

    // item 3: envia com sucesso — avança a rotação via marcarContatoEnviado
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledTimes(1);
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledWith({
      disparoContatoId: 3,
      templateUsadoId: 20, // próximo depois do id=10
      mensagemEnviada: 'E aí Ana!',
    });

    // item 4: falha no sendMessage — falha, sem avançar ConfiguracoesEnvio
    expect(disparosModel.marcarContatoFalha).toHaveBeenCalledWith(4, 'timeout de rede');

    // nenhum item além do 3 deve ter avançado a rotação
    expect(disparosModel.marcarContatoEnviado).toHaveBeenCalledTimes(1);

    // itens 1 e 2 nunca chegaram a calcular/consumir template algum
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
      templateUsadoId: 10, // ciclou de volta ao primeiro
      mensagemEnviada: 'Template 1 Ana',
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
    const jidResolvido = '551188887777@s.whatsapp.net'; // sem o 9º dígito extra
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: jidResolvido, exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await processarCicloEnvio();

    expect(sendMessage).toHaveBeenCalledWith(jidResolvido, { text: 'Oi Ana' });
    expect(sendMessage).not.toHaveBeenCalledWith('5511988887777@s.whatsapp.net', expect.anything());
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
});
