// Este service fala com a lib Baileys de verdade e com o sistema de
// arquivos. IMPORTANTE (deixe este comentário se for tocar neste arquivo):
// `vi.mock('@whiskeysockets/baileys', ...)` NÃO funciona neste projeto —
// confirmado manualmente antes de escrever este arquivo. `@whiskeysockets/
// baileys` é um pacote ESM puro; o `require()`ado dentro do Vitest vira um
// objeto de namespace ESM com propriedades não-configuráveis, então nem
// `vi.mock` nem `vi.spyOn` conseguem substituir `makeWASocket`/
// `useMultiFileAuthState` diretamente (erro do Vitest: "Module namespace is
// not configurable in ESM"). Por isso `baileysSession.service.js` expõe
// `_baileysLib` (objeto literal comum, com propriedades configuráveis) só
// para este teste poder `vi.spyOn` nele — ver o comentário ao lado da
// declaração de `baileysLib` no service. `fs` (módulo builtin real) já é
// espiável normalmente com `vi.spyOn`, sem precisar de indireção nenhuma.
// Mesmo princípio de guarda usado em `numerosRemetentes.service.test.js`:
// nenhum destes testes deve tentar uma conexão real com o Azure SQL.

const fs = require('fs');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const baileysSessionService = require('./baileysSession.service');

const { _baileysLib: baileysLib } = baileysSessionService;

// Flush de macrotask — suficiente para deixar as promises internas do
// service (ex.: `await baileysLib.useMultiFileAuthState(...)`) resolverem
// antes de simularmos o próximo evento do socket falso.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Configura `baileysLib.makeWASocket` para devolver, a cada chamada, um
 * socket falso que guarda o handler de `connection.update` registrado, e
 * empurra cada socket criado em `socksCriados` (na ordem de criação) para o
 * teste poder simular eventos nele.
 */
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

  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
  vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

  vi.spyOn(baileysLib, 'useMultiFileAuthState').mockResolvedValue({ state: {}, saveCreds: vi.fn() });
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

    // `persistirConectado` (parte da máquina de eventos já existente) grava
    // numero+status='conectado' — a rotina de boot não precisa gravar de novo.
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

    // a rotina de boot sempre finaliza uma falha como 'desconectado' (nunca
    // 'aguardando_conexao', que é o valor que o tratamento de logout em
    // runtime grava) — a última chamada de updateConexao vence.
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

    // Nenhum evento de connection.update é emitido — a sessão nunca resolve
    // sozinha, então precisa do timeout curto para desistir.
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

    // Só o primeiro socket deve existir enquanto o primeiro número não foi
    // resolvido — se fosse Promise.all, os dois já existiriam aqui.
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
