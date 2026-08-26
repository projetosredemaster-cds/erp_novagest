const fs = require('fs');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const mensagensModel = require('../models/mensagens.model');
const mensagensEventsService = require('./mensagensEvents.service');
const baileysSessionService = require('./baileysSession.service');

const { _baileysLib: baileysLib, gerarVariantesTelefoneBr } = baileysSessionService;

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function configurarMakeWASocket(socksCriados) {
  vi.spyOn(baileysLib, 'makeWASocket').mockImplementation(() => {
    const handlers = {};
    const sock = {
      ev: {
        on: vi.fn((evento, cb) => {
          handlers[evento] = cb;
        }),
      },
      end: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
      user: { id: '5598912345678:1@s.whatsapp.net' },
      signalRepository: {
        lidMapping: {
          getPNForLID: vi.fn().mockResolvedValue(null),
        },
      },
      emit: (evento, payload) => handlers[evento]?.(payload),
    };
    socksCriados.push(sock);
    return sock;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();

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

  mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);

  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

  vi.spyOn(baileysLib, 'useMultiFileAuthState').mockResolvedValue({ state: {}, saveCreds: vi.fn() });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(mensagensEventsService, 'emit');
});

describe('baileysSession.reconciliarSessoesNoBoot', () => {
  it('não faz nada quando nenhum número está "conectado" no banco', async () => {
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([]);

    await expect(baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 200 })).resolves.toBeUndefined();

    expect(numerosRemetentesModel.updateConexao).not.toHaveBeenCalled();
  });

  it('restaura com sucesso um número "conectado" cuja sessão reconecta (connection: open)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 7 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    const promise = baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 5000 });

    await flush();
    expect(socksCriados).toHaveLength(1);
    socksCriados[0].emit('connection.update', { connection: 'open' });

    await promise;

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(7, {
      numero: '5598912345678',
      statusConexao: 'conectado',
    });
    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledTimes(1);
    expect(fs.promises.rm).not.toHaveBeenCalled();
    expect(baileysSessionService.getStatusEmMemoria(7)).not.toBeNull();
    expect(baileysSessionService.getStatusEmMemoria(7)).toBe('conectado');
  });

  it('marca como desconectado quando a pasta de sessão não existe em disco', async () => {
    fs.existsSync.mockReturnValue(false);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 9 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);
    const spyMakeWASocket = vi.spyOn(baileysLib, 'makeWASocket');

    await baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 200 });

    expect(spyMakeWASocket).not.toHaveBeenCalled();
    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(9, {
      numero: null,
      statusConexao: 'desconectado',
    });
    expect(fs.promises.rm).toHaveBeenCalled();
    expect(baileysSessionService.getStatusEmMemoria(9)).toBeNull();
  });

  it('marca como desconectado quando a restauração pede um QR novo (credencial inválida)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 11 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    const promise = baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 5000 });

    await flush();
    expect(socksCriados).toHaveLength(1);
    socksCriados[0].emit('connection.update', { qr: 'qr-de-teste' });

    await promise;

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(11, {
      numero: null,
      statusConexao: 'desconectado',
    });
    expect(fs.promises.rm).toHaveBeenCalled();
    expect(baileysSessionService.getStatusEmMemoria(11)).toBeNull();
  });

  it('marca como desconectado quando o Baileys reporta logout definitivo (connection: close, statusCode 401)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 13 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    const promise = baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 5000 });

    await flush();
    socksCriados[0].emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    await promise;

    expect(numerosRemetentesModel.updateConexao).toHaveBeenLastCalledWith(13, {
      numero: null,
      statusConexao: 'desconectado',
    });
    expect(baileysSessionService.getStatusEmMemoria(13)).toBeNull();
  });

  it('marca como desconectado quando a restauração estoura o timeout', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 17 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    await baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 10 });

    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(17, {
      numero: null,
      statusConexao: 'desconectado',
    });
    expect(baileysSessionService.getStatusEmMemoria(17)).toBeNull();
  });

  it('processa múltiplos números em sequência, nunca em paralelo', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    numerosRemetentesModel.listNumerosPorStatusConexao.mockResolvedValue([{ id: 21 }, { id: 22 }]);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    const promise = baileysSessionService.reconciliarSessoesNoBoot({ delayMs: 0, timeoutMs: 5000 });

    await flush();
    expect(socksCriados).toHaveLength(1);

    socksCriados[0].emit('connection.update', { connection: 'open' });
    await flush();

    expect(socksCriados).toHaveLength(2);
    socksCriados[1].emit('connection.update', { connection: 'open' });

    await promise;

    expect(numerosRemetentesModel.updateConexao.mock.calls.map((call) => call[0])).toEqual([21, 22]);
  });
});

describe('baileysSession messages.upsert listener (Central de Mensagens)', () => {
  it('grava a mensagem recebida quando type=notify e o contato existe', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(42);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 1, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(100, {});
    expect(socksCriados).toHaveLength(1);

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598912345678@s.whatsapp.net', fromMe: false, id: 'ABC123' },
          message: { conversation: 'Oi, tudo bem?' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(gerarVariantesTelefoneBr('5598912345678'));
    expect(mensagensModel.existeMensagemClienteAnterior).toHaveBeenCalledWith(42, 100);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 42,
      numeroRemetenteId: 100,
      corpo: 'Oi, tudo bem?',
      baileysMessageId: 'ABC123',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
    expect(mensagensEventsService.emit).toHaveBeenCalledWith('mensagem-recebida', {
      contatoId: 42,
      numeroRemetenteId: 100,
      primeiraResposta: true,
    });
  });

  it('marca ePrimeiraRespostaCliente=false e emit primeiraResposta=false quando o contato já tinha mensagem de cliente antes', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(44);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(true);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 4, e_primeira_resposta_cliente: false });

    await baileysSessionService.abrirConexao(108, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598912345680@s.whatsapp.net', fromMe: false, id: 'ABC124' },
          message: { conversation: 'De novo, oi' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.existeMensagemClienteAnterior).toHaveBeenCalledWith(44, 108);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 44,
      numeroRemetenteId: 108,
      corpo: 'De novo, oi',
      baileysMessageId: 'ABC124',
      ePrimeiraRespostaCliente: false,
      remetente: 'cliente',
      statusEntrega: null,
    });
    expect(mensagensEventsService.emit).toHaveBeenCalledWith('mensagem-recebida', {
      contatoId: 44,
      numeroRemetenteId: 108,
      primeiraResposta: false,
    });
  });

  it('NÃO emite "mensagem-recebida" quando a inserção é ignorada por dedup (inserirMensagemRecebida retorna null)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(43);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue(null);

    await baileysSessionService.abrirConexao(107, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598912345679@s.whatsapp.net', fromMe: false, id: 'DUP1' },
          message: { conversation: 'evento duplicado do Baileys' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalled();
    expect(mensagensEventsService.emit).not.toHaveBeenCalled();
  });

  it('ignora eventos type=append (sincronização de histórico no boot)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);

    await baileysSessionService.abrirConexao(101, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'append',
      messages: [
        { key: { remoteJid: '5598912345678@s.whatsapp.net', fromMe: false, id: 'OLD1' }, message: { conversation: 'histórico' } },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).not.toHaveBeenCalled();
    expect(mensagensModel.inserirMensagemRecebida).not.toHaveBeenCalled();
  });

  it('grava mensagens com key.fromMe=true como remetente "atendente" (envio manual pelo celular do atendente, não eco de disparo automático)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);

    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(90);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 40, e_primeira_resposta_cliente: false });

    await baileysSessionService.abrirConexao(102, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: '5598912345678@s.whatsapp.net', fromMe: true, id: 'X1' }, message: { conversation: 'oi' } },
      ],
    });
    await flush();

    expect(mensagensModel.existeMensagemClienteAnterior).not.toHaveBeenCalled();
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 90,
      numeroRemetenteId: 102,
      corpo: 'oi',
      baileysMessageId: 'X1',
      ePrimeiraRespostaCliente: false,
      remetente: 'atendente',
      statusEntrega: 'enviado',
    });
    expect(mensagensEventsService.emit).toHaveBeenCalledWith('mensagem-recebida', {
      contatoId: 90,
      numeroRemetenteId: 102,
      primeiraResposta: false,
    });
  });

  it('ignora mensagem cujo telefone não corresponde a nenhum Contato conhecido (ex.: grupo)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(null);

    await baileysSessionService.abrirConexao(103, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: '12036304000-12345@g.us', fromMe: false, id: 'G1' }, message: { conversation: 'oi grupo' } },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(gerarVariantesTelefoneBr('1203630400012345'));
    expect(mensagensModel.inserirMensagemRecebida).not.toHaveBeenCalled();
  });

  it('usa o placeholder de mídia quando a mensagem não tem conversation/extendedTextMessage', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(55);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 2 });

    await baileysSessionService.abrirConexao(104, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: '5598900000000@s.whatsapp.net', fromMe: false, id: 'M1' }, message: { audioMessage: {} } },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 55,
      numeroRemetenteId: 104,
      corpo: '[Mensagem de mídia não suportada nesta versão]',
      baileysMessageId: 'M1',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('extrai o texto de extendedTextMessage quando conversation está ausente', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(56);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 3 });

    await baileysSessionService.abrirConexao(105, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598900000001@s.whatsapp.net', fromMe: false, id: 'M2' },
          message: { extendedTextMessage: { text: 'Mensagem com link' } },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 56,
      numeroRemetenteId: 105,
      corpo: 'Mensagem com link',
      baileysMessageId: 'M2',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('erro inesperado no handler não derruba o processo (só loga)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockRejectedValue(new Error('falha de banco'));

    await baileysSessionService.abrirConexao(106, {});

    expect(() => {
      socksCriados[0].emit('messages.upsert', {
        type: 'notify',
        messages: [
          { key: { remoteJid: '5598900000002@s.whatsapp.net', fromMe: false, id: 'M3' }, message: { conversation: 'oi' } },
        ],
      });
    }).not.toThrow();

    await flush();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('baileysSession.gerarVariantesTelefoneBr', () => {
  it('devolve só o original quando o formato não é 12 nem 13 dígitos (não-BR-celular)', () => {
    expect(gerarVariantesTelefoneBr('1203630400012345')).toEqual(['1203630400012345']);
  });

  it('gera a variante com o 9º dígito quando o original tem 12 dígitos (55+DD+8 dígitos)', () => {
    expect(gerarVariantesTelefoneBr('558582336124')).toEqual(['558582336124', '5585982336124']);
  });

  it('gera a variante sem o 9º dígito quando o original tem 13 dígitos com "9" na posição 4', () => {
    expect(gerarVariantesTelefoneBr('5585982336124')).toEqual(['5585982336124', '558582336124']);
  });

  it('não gera variante para 13 dígitos cujo 5º caractere não é "9" (não é celular com 9º dígito)', () => {
    expect(gerarVariantesTelefoneBr('5585123456789')).toEqual(['5585123456789']);
  });

  it('não quebra com telefone vazio/nulo', () => {
    expect(gerarVariantesTelefoneBr('')).toEqual(['']);
    expect(gerarVariantesTelefoneBr(null)).toEqual(['']);
  });
});

describe('baileysSession messages.upsert — bug do 9º dígito do celular brasileiro', () => {
  it('encontra o Contato quando o telefone recebido está SEM o 9 mas o Contato foi gravado COM o 9 (caso real de teste)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(80);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 20 });

    await baileysSessionService.abrirConexao(300, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '558582336124@s.whatsapp.net', fromMe: false, id: 'NOVE1' },
          message: { conversation: 'oi, sem o 9' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(['558582336124', '5585982336124']);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 80,
      numeroRemetenteId: 300,
      corpo: 'oi, sem o 9',
      baileysMessageId: 'NOVE1',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('encontra o Contato quando o telefone recebido está COM o 9 mas o Contato foi gravado SEM o 9', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(81);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 21 });

    await baileysSessionService.abrirConexao(301, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5585982336124@s.whatsapp.net', fromMe: false, id: 'NOVE2' },
          message: { conversation: 'oi, com o 9' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(['5585982336124', '558582336124']);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 81,
      numeroRemetenteId: 301,
      corpo: 'oi, com o 9',
      baileysMessageId: 'NOVE2',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('continua funcionando quando o telefone recebido bate exato (regressão — nenhuma variante necessária)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(82);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 22 });

    await baileysSessionService.abrirConexao(302, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5585982336124@s.whatsapp.net', fromMe: false, id: 'EXATO1' },
          message: { conversation: 'match exato' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(['5585982336124', '558582336124']);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 82,
      numeroRemetenteId: 302,
      corpo: 'match exato',
      baileysMessageId: 'EXATO1',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('telefone de formato não-BR-celular (nem 12 nem 13 dígitos) só tenta o original, nenhuma variante', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(null);

    await baileysSessionService.abrirConexao(303, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '12036304000-12345@g.us', fromMe: false, id: 'GRUPO1' },
          message: { conversation: 'oi grupo' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(['1203630400012345']);
    expect(mensagensModel.inserirMensagemRecebida).not.toHaveBeenCalled();
  });
});

describe('baileysSession messages.upsert com remoteJid endereçado por LID (@lid)', () => {
  it('resolve o telefone via key.remoteJidAlt quando presente, sem consultar signalRepository', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(70);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 10 });

    await baileysSessionService.abrirConexao(200, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: {
            remoteJid: '142601739075682@lid',
            remoteJidAlt: '5598912345678:0@s.whatsapp.net',
            fromMe: false,
            id: 'LID1',
          },
          message: { conversation: 'Oi, cheguei via LID' },
        },
      ],
    });
    await flush();

    expect(socksCriados[0].signalRepository.lidMapping.getPNForLID).not.toHaveBeenCalled();
    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(gerarVariantesTelefoneBr('5598912345678'));
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 70,
      numeroRemetenteId: 200,
      corpo: 'Oi, cheguei via LID',
      baileysMessageId: 'LID1',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('resolve o telefone via signalRepository.lidMapping.getPNForLID quando remoteJidAlt está ausente', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(71);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 11 });

    await baileysSessionService.abrirConexao(201, {});
    socksCriados[0].signalRepository.lidMapping.getPNForLID.mockResolvedValue('5598900000009:0@s.whatsapp.net');

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '142601739075682@lid', fromMe: false, id: 'LID2' },
          message: { conversation: 'Oi de novo' },
        },
      ],
    });
    await flush();

    expect(socksCriados[0].signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith('142601739075682@lid');
    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(gerarVariantesTelefoneBr('5598900000009'));
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith({
      contatoId: 71,
      numeroRemetenteId: 201,
      corpo: 'Oi de novo',
      baileysMessageId: 'LID2',
      ePrimeiraRespostaCliente: true,
      remetente: 'cliente',
      statusEntrega: null,
    });
  });

  it('ignora (logando "LID não resolvido") quando nem remoteJidAlt nem getPNForLID resolvem o telefone', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);

    await baileysSessionService.abrirConexao(202, {});
    // getPNForLID já resolve `null` por padrão (ver configurarMakeWASocket).

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { remoteJid: '142601739075682@lid', fromMe: false, id: 'LID3' }, message: { conversation: 'oi' } },
      ],
    });
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).not.toHaveBeenCalled();
    expect(mensagensModel.inserirMensagemRecebida).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('LID não resolvido'));
  });

  it('não usa remoteJidAlt se ele mesmo também for um LID (dado inconsistente) — cai para getPNForLID', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(72);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 12 });

    await baileysSessionService.abrirConexao(203, {});
    socksCriados[0].signalRepository.lidMapping.getPNForLID.mockResolvedValue('5598900000010:0@s.whatsapp.net');

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: {
            remoteJid: '142601739075682@lid',
            remoteJidAlt: '999999999999999@lid',
            fromMe: false,
            id: 'LID4',
          },
          message: { conversation: 'oi' },
        },
      ],
    });
    await flush();

    expect(socksCriados[0].signalRepository.lidMapping.getPNForLID).toHaveBeenCalledWith('142601739075682@lid');
    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).toHaveBeenCalledWith(gerarVariantesTelefoneBr('5598900000010'));
  });

  it('erro ao consultar getPNForLID é capturado e tratado como LID não resolvido (não derruba o handler)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);

    await baileysSessionService.abrirConexao(204, {});
    socksCriados[0].signalRepository.lidMapping.getPNForLID.mockRejectedValue(new Error('falha de rede'));

    expect(() => {
      socksCriados[0].emit('messages.upsert', {
        type: 'notify',
        messages: [
          { key: { remoteJid: '142601739075682@lid', fromMe: false, id: 'LID5' }, message: { conversation: 'oi' } },
        ],
      });
    }).not.toThrow();
    await flush();

    expect(mensagensModel.findContatoIdPorTelefoneComVariantes).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('LID não resolvido'));
  });
});

describe('baileysSession.desembrulharMensagem', () => {
  it('desembrulha extendedTextMessage dentro de ephemeralMessage', () => {
    const message = {
      ephemeralMessage: {
        message: {
          extendedTextMessage: { text: 'Mensagem temporária com link' },
        },
      },
    };

    const desembrulhada = baileysSessionService.desembrulharMensagem(message);

    expect(desembrulhada).toEqual({ extendedTextMessage: { text: 'Mensagem temporária com link' } });
    expect(baileysSessionService.extrairTextoDaMensagem(desembrulhada, 999)).toBe('Mensagem temporária com link');
  });

  it('desembrulha conversation dentro de ephemeralMessage', () => {
    const message = { ephemeralMessage: { message: { conversation: 'Oi temporário' } } };

    const desembrulhada = baileysSessionService.desembrulharMensagem(message);

    expect(desembrulhada).toEqual({ conversation: 'Oi temporário' });
    expect(baileysSessionService.extrairTextoDaMensagem(desembrulhada, 999)).toBe('Oi temporário');
  });

  it('desembrulha texto dentro de viewOnceMessage', () => {
    const message = { viewOnceMessage: { message: { conversation: 'Ver uma vez' } } };

    const desembrulhada = baileysSessionService.desembrulharMensagem(message);

    expect(desembrulhada).toEqual({ conversation: 'Ver uma vez' });
    expect(baileysSessionService.extrairTextoDaMensagem(desembrulhada, 999)).toBe('Ver uma vez');
  });

  it('desembrulha texto dentro de viewOnceMessageV2', () => {
    const message = { viewOnceMessageV2: { message: { extendedTextMessage: { text: 'Ver uma vez v2' } } } };

    const desembrulhada = baileysSessionService.desembrulharMensagem(message);

    expect(desembrulhada).toEqual({ extendedTextMessage: { text: 'Ver uma vez v2' } });
    expect(baileysSessionService.extrairTextoDaMensagem(desembrulhada, 999)).toBe('Ver uma vez v2');
  });

  it('desembrulha envelopes aninhados (ephemeralMessage contendo viewOnceMessage contendo o texto real)', () => {
    const message = {
      ephemeralMessage: {
        message: {
          viewOnceMessage: {
            message: { conversation: 'Aninhado duplo' },
          },
        },
      },
    };

    const desembrulhada = baileysSessionService.desembrulharMensagem(message);

    expect(desembrulhada).toEqual({ conversation: 'Aninhado duplo' });
    expect(baileysSessionService.extrairTextoDaMensagem(desembrulhada, 999)).toBe('Aninhado duplo');
  });

  it('devolve a própria mensagem quando não há envelope conhecido (mídia direta, sem envelope)', () => {
    const message = { audioMessage: {} };

    expect(baileysSessionService.desembrulharMensagem(message)).toBe(message);
  });

  it('não quebra com mensagem nula/indefinida', () => {
    expect(baileysSessionService.desembrulharMensagem(null)).toBeNull();
    expect(baileysSessionService.desembrulharMensagem(undefined)).toBeNull();
  });
});

describe('baileysSession.extrairTextoDaMensagem', () => {
  it('retorna o placeholder de mídia para um tipo totalmente desconhecido, sem lançar exceção, e loga as chaves', () => {
    const desembrulhada = { algumTipoNuncaVistoAntes: { dados: 'xyz' } };

    const resultado = baileysSessionService.extrairTextoDaMensagem(desembrulhada, 555);

    expect(resultado).toBe('[Mensagem de mídia não suportada nesta versão]');
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('tipo de mensagem não reconhecido'),
      ['algumTipoNuncaVistoAntes']
    );
  });
});

describe('baileysSession messages.upsert — mensagens envelopadas (ephemeral/viewOnce) não somem mais', () => {
  it('grava a mensagem de texto que veio dentro de ephemeralMessage (regressão do bug relatado)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(60);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 30, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(500, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598933333333@s.whatsapp.net', fromMe: false, id: 'EPH1' },
          message: { ephemeralMessage: { message: { conversation: 'mensagem temporária' } } },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({ corpo: 'mensagem temporária', baileysMessageId: 'EPH1', contatoId: 60 })
    );
  });

  it('grava a mensagem de texto que veio dentro de viewOnceMessage', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(63);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 33, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(503, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598966666666@s.whatsapp.net', fromMe: false, id: 'VO1' },
          message: { viewOnceMessage: { message: { conversation: 'ver uma vez' } } },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({ corpo: 'ver uma vez', baileysMessageId: 'VO1', contatoId: 63 })
    );
  });

  it('grava a mensagem de texto que veio dentro de ephemeralMessage > viewOnceMessage (envelopes aninhados)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(61);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 31, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(501, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598944444444@s.whatsapp.net', fromMe: false, id: 'NEST1' },
          message: {
            ephemeralMessage: {
              message: {
                viewOnceMessage: {
                  message: { extendedTextMessage: { text: 'texto aninhado duplo' } },
                },
              },
            },
          },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({ corpo: 'texto aninhado duplo', baileysMessageId: 'NEST1', contatoId: 61 })
    );
  });

  it('mensagem de tipo totalmente desconhecido ainda é inserida com o placeholder, nunca descartada silenciosamente', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(62);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 32, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(502, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598955555555@s.whatsapp.net', fromMe: false, id: 'UNK1' },
          message: { algumTipoFuturoAindaNaoSuportado: { blah: true } },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({
        corpo: '[Mensagem de mídia não suportada nesta versão]',
        baileysMessageId: 'UNK1',
        contatoId: 62,
      })
    );
  });
});

describe('baileysSession messages.upsert — protocolMessage (edição) e resiliência do batch', () => {
  it('ignora protocolMessage sem chamar inserirMensagemRecebida, mas processa as outras mensagens do mesmo batch (2 inserções, não 0 e não 1)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(90);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida.mockResolvedValue({ id: 1, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(400, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598911111111@s.whatsapp.net', fromMe: false, id: 'TXT1' },
          message: { conversation: 'primeira mensagem normal' },
        },
        {
          key: { remoteJid: '5598911111111@s.whatsapp.net', fromMe: false, id: 'EDIT1' },
          message: { protocolMessage: { type: 14, key: { id: 'TXT1' } } },
        },
        {
          key: { remoteJid: '5598911111111@s.whatsapp.net', fromMe: false, id: 'TXT2' },
          message: { conversation: 'segunda mensagem normal' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledTimes(2);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({ corpo: 'primeira mensagem normal', baileysMessageId: 'TXT1' })
    );
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledWith(
      expect.objectContaining({ corpo: 'segunda mensagem normal', baileysMessageId: 'TXT2' })
    );

    const idsChamados = mensagensModel.inserirMensagemRecebida.mock.calls.map((call) => call[0].baileysMessageId);
    expect(idsChamados).not.toContain('EDIT1');
  });

  it('resiliência do batch: exceção ao processar UMA mensagem não impede o processamento das mensagens seguintes (try/catch por mensagem)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.findContatoIdPorTelefoneComVariantes.mockResolvedValue(91);
    mensagensModel.existeMensagemClienteAnterior.mockResolvedValue(false);
    mensagensModel.inserirMensagemRecebida
      .mockRejectedValueOnce(new Error('falha simulada ao inserir a primeira mensagem'))
      .mockResolvedValueOnce({ id: 2, e_primeira_resposta_cliente: true });

    await baileysSessionService.abrirConexao(401, {});

    socksCriados[0].emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { remoteJid: '5598922222222@s.whatsapp.net', fromMe: false, id: 'FAIL1' },
          message: { conversation: 'essa vai falhar ao inserir' },
        },
        {
          key: { remoteJid: '5598922222222@s.whatsapp.net', fromMe: false, id: 'OK1' },
          message: { conversation: 'essa deve ser processada mesmo assim' },
        },
      ],
    });
    await flush();

    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenCalledTimes(2);
    expect(mensagensModel.inserirMensagemRecebida).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ corpo: 'essa deve ser processada mesmo assim', baileysMessageId: 'OK1' })
    );
    expect(console.error).toHaveBeenCalled();
    expect(mensagensEventsService.emit).toHaveBeenCalledWith(
      'mensagem-recebida',
      expect.objectContaining({ contatoId: 91, numeroRemetenteId: 401 })
    );
  });
});

describe('baileysSession messages.update listener (status de entrega)', () => {
  it('status avançando (ex.: enviado → entregue) chama atualizarStatusEntrega e emite "mensagem-status-atualizada"', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.atualizarStatusEntrega.mockResolvedValue({
      contato_id: 42,
      numero_remetente_id: 600,
      status_entrega: 'entregue',
    });

    await baileysSessionService.abrirConexao(600, {});

    socksCriados[0].emit('messages.update', [
      { key: { id: 'MSG1' }, update: { status: 3 } },
    ]);
    await flush();

    expect(mensagensModel.atualizarStatusEntrega).toHaveBeenCalledWith('MSG1', 'entregue');
    expect(mensagensEventsService.emit).toHaveBeenCalledWith('mensagem-status-atualizada', {
      contatoId: 42,
      numeroRemetenteId: 600,
      baileysMessageId: 'MSG1',
      status: 'entregue',
    });
  });

  it('não emite nada quando o baileysMessageId não corresponde a nenhuma mensagem conhecida (atualizarStatusEntrega retorna null)', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.atualizarStatusEntrega.mockResolvedValue(null);

    await baileysSessionService.abrirConexao(601, {});

    socksCriados[0].emit('messages.update', [
      { key: { id: 'DESCONHECIDO' }, update: { status: 4 } },
    ]);
    await flush();

    expect(mensagensModel.atualizarStatusEntrega).toHaveBeenCalledWith('DESCONHECIDO', 'lido');
    expect(mensagensEventsService.emit).not.toHaveBeenCalledWith('mensagem-status-atualizada', expect.anything());
  });

  it('código de status desconhecido (ex.: PENDING=1) é ignorado sem chamar o model nem lançar erro', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);

    await baileysSessionService.abrirConexao(602, {});

    expect(() => {
      socksCriados[0].emit('messages.update', [
        { key: { id: 'MSG2' }, update: { status: 1 } },
        { key: { id: 'MSG3' }, update: { status: 999 } },
      ]);
    }).not.toThrow();
    await flush();

    expect(mensagensModel.atualizarStatusEntrega).not.toHaveBeenCalled();
    expect(mensagensEventsService.emit).not.toHaveBeenCalledWith('mensagem-status-atualizada', expect.anything());
  });

  it('erro inesperado ao atualizar uma mensagem não impede o processamento das seguintes do mesmo lote', async () => {
    const socksCriados = [];
    configurarMakeWASocket(socksCriados);
    mensagensModel.atualizarStatusEntrega
      .mockRejectedValueOnce(new Error('falha de banco'))
      .mockResolvedValueOnce({ contato_id: 1, numero_remetente_id: 603, status_entrega: 'enviado' });

    await baileysSessionService.abrirConexao(603, {});

    socksCriados[0].emit('messages.update', [
      { key: { id: 'FAIL1' }, update: { status: 2 } },
      { key: { id: 'OK1' }, update: { status: 2 } },
    ]);
    await flush();

    expect(mensagensModel.atualizarStatusEntrega).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
    expect(mensagensEventsService.emit).toHaveBeenCalledWith('mensagem-status-atualizada', {
      contatoId: 1,
      numeroRemetenteId: 603,
      baileysMessageId: 'OK1',
      status: 'enviado',
    });
  });
});
