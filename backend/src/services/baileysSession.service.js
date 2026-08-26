const path = require('path');
const fs = require('fs');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidDecode,
} = require('@whiskeysockets/baileys');

const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const mensagensModel = require('../models/mensagens.model');
const mensagensEventsService = require('./mensagensEvents.service');

const baileysLib = {
  makeWASocket: (...args) => makeWASocket(...args),
  useMultiFileAuthState: (...args) => useMultiFileAuthState(...args),
};

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions', 'baileys');
const MAX_RECONNECT_ATTEMPTS = 3;
const QR_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos sem o QR ser escaneado

const BOOT_RECONCILE_DELAY_MS = 2500;
const BOOT_RECONCILE_TIMEOUT_MS = 20000;

const sessoes = new Map();

function sessionDir(numeroRemetenteId) {
  return path.join(SESSIONS_DIR, String(numeroRemetenteId));
}

async function removerPastaSessao(numeroRemetenteId) {
  const dir = sessionDir(numeroRemetenteId);
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`[baileysSession] falha ao remover pasta de sessão de ${numeroRemetenteId}:`, err);
  }
}

function extrairNumero(sock) {
  const jid = sock?.user?.id;
  if (!jid) return null;
  return jid.split(':')[0].split('@')[0];
}

function limparTimeoutQr(sessao) {
  if (sessao.qrTimeoutHandle) {
    clearTimeout(sessao.qrTimeoutHandle);
    sessao.qrTimeoutHandle = null;
  }
}

function broadcastQr(sessao, qr) {
  sessao.ultimoQr = qr;
  for (const listener of sessao.listeners) {
    try {
      listener.onQr?.(qr);
    } catch (err) {
      console.error('[baileysSession] erro ao notificar listener (qr):', err);
    }
  }
}

function broadcastConectado(sessao, numero) {
  for (const listener of sessao.listeners) {
    try {
      listener.onConectado?.(numero);
    } catch (err) {
      console.error('[baileysSession] erro ao notificar listener (conectado):', err);
    }
  }
}

function broadcastErro(sessao, mensagem) {
  for (const listener of sessao.listeners) {
    try {
      listener.onErro?.(mensagem);
    } catch (err) {
      console.error('[baileysSession] erro ao notificar listener (erro):', err);
    }
  }
}

async function persistirConectado(numeroRemetenteId, numero) {
  try {
    await numerosRemetentesModel.updateConexao(numeroRemetenteId, { numero, statusConexao: 'conectado' });
  } catch (err) {
    console.error(`[baileysSession] falha ao gravar conexão confirmada no banco (numeroRemetenteId=${numeroRemetenteId}):`, err);
  }
}

async function persistirDesconectadoPorFalhaDeReconexao(numeroRemetenteId) {
  try {
    await numerosRemetentesModel.updateConexao(numeroRemetenteId, { statusConexao: 'desconectado' });
  } catch (err) {
    console.error(`[baileysSession] falha ao gravar status "desconectado" no banco (numeroRemetenteId=${numeroRemetenteId}):`, err);
  }
}

async function persistirLogoutForcado(numeroRemetenteId) {
  try {
    await numerosRemetentesModel.updateConexao(numeroRemetenteId, { numero: null, statusConexao: 'aguardando_conexao' });
  } catch (err) {
    console.error(`[baileysSession] falha ao gravar logout forçado no banco (numeroRemetenteId=${numeroRemetenteId}):`, err);
  }
}

async function iniciarSocket(numeroRemetenteId, sessao) {
  const dir = sessionDir(numeroRemetenteId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await baileysLib.useMultiFileAuthState(dir);
  const sock = baileysLib.makeWASocket({ auth: state });

  sessao.sock = sock;
  sessao.status = 'conectando';

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    handleConnectionUpdate(numeroRemetenteId, sessao, update).catch((err) => {
      console.error(`[baileysSession] erro inesperado tratando connection.update (numeroRemetenteId=${numeroRemetenteId}):`, err);
    });
  });

  sock.ev.on('messages.upsert', (upsert) => {
    handleMessagesUpsert(numeroRemetenteId, sock, upsert).catch((err) => {
      console.error(`[baileysSession] erro inesperado tratando messages.upsert (numeroRemetenteId=${numeroRemetenteId}):`, err);
    });
  });

  limparTimeoutQr(sessao);
  sessao.qrTimeoutHandle = setTimeout(() => {
    const atual = sessoes.get(numeroRemetenteId);
    if (!atual || atual.status === 'conectado') return;

    console.log(`[baileysSession] timeout de QR (${QR_TIMEOUT_MS}ms) sem escaneamento para numeroRemetenteId=${numeroRemetenteId}; encerrando sessão.`);
    broadcastErro(atual, 'Tempo esgotado aguardando leitura do QR Code. Tente novamente.');
    encerrarSessaoEmMemoria(numeroRemetenteId, atual);
  }, QR_TIMEOUT_MS);
}

function encerrarSessaoEmMemoria(numeroRemetenteId, sessao) {
  limparTimeoutQr(sessao);
  try {
    sessao.sock?.end?.(undefined);
  } catch (err) {
    console.error(`[baileysSession] erro ao encerrar socket em memória (numeroRemetenteId=${numeroRemetenteId}):`, err);
  }
  sessoes.delete(numeroRemetenteId);
}

async function handleConnectionUpdate(numeroRemetenteId, sessao, update) {
  const atual = sessoes.get(numeroRemetenteId);
  if (!atual || atual !== sessao) return; 

  const { connection, qr, lastDisconnect } = update;

  if (qr) {
    broadcastQr(sessao, qr);
  }

  if (connection === 'open') {
    limparTimeoutQr(sessao);
    sessao.status = 'conectado';
    sessao.reconnectAttempts = 0;
    const numero = extrairNumero(sessao.sock);
    sessao.numero = numero;
    await persistirConectado(numeroRemetenteId, numero);
    broadcastConectado(sessao, numero);
    return;
  }

  if (connection === 'close') {
    if (sessao.fechando) {
      return;
    }

    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (statusCode === DisconnectReason.restartRequired) {
      console.log(`[baileysSession] restart pós-pareamento esperado (numeroRemetenteId=${numeroRemetenteId}); reabrindo socket.`);
      await iniciarSocket(numeroRemetenteId, sessao);
      return;
    }

    if (statusCode === DisconnectReason.loggedOut) {
      console.log(`[baileysSession] logout forçado pelo WhatsApp (numeroRemetenteId=${numeroRemetenteId}).`);
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      await removerPastaSessao(numeroRemetenteId);
      await persistirLogoutForcado(numeroRemetenteId);
      broadcastErro(sessao, 'A conexão foi encerrada pelo WhatsApp. É necessário escanear o QR novamente.');
      return;
    }

    if (sessao.status !== 'conectado') {
      console.log(`[baileysSession] conexão encerrada antes de completar o pareamento (numeroRemetenteId=${numeroRemetenteId}), statusCode=${statusCode}.`);
      broadcastErro(sessao, 'Não foi possível concluir a conexão. Tente novamente.');
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      return;
    }

    sessao.reconnectAttempts += 1;
    if (sessao.reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      const tentativa = sessao.reconnectAttempts;
      const delayMs = tentativa * 2000;
      console.log(`[baileysSession] conexão caiu inesperadamente (numeroRemetenteId=${numeroRemetenteId}, statusCode=${statusCode}); tentativa de reconexão ${tentativa}/${MAX_RECONNECT_ATTEMPTS} em ${delayMs}ms...`);
      setTimeout(() => {
        const aindaAtual = sessoes.get(numeroRemetenteId);
        if (!aindaAtual || aindaAtual !== sessao) return;
        iniciarSocket(numeroRemetenteId, sessao).catch((err) => {
          console.error(`[baileysSession] falha ao tentar reconectar (numeroRemetenteId=${numeroRemetenteId}):`, err);
        });
      }, delayMs);
      return;
    }

    console.error(`[baileysSession] reconexão automática esgotada após ${MAX_RECONNECT_ATTEMPTS} tentativas (numeroRemetenteId=${numeroRemetenteId}); marcando como desconectado.`);
    encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
    await persistirDesconectadoPorFalhaDeReconexao(numeroRemetenteId);
    broadcastErro(sessao, 'A conexão foi perdida e não foi possível restabelecê-la automaticamente.');
  }
}

const MENSAGEM_MIDIA_PLACEHOLDER = '[Mensagem de mídia não suportada nesta versão]';

function normalizarTelefoneDeJid(jid) {
  if (!jid) return null;
  const [semServidor] = String(jid).split('@');
  const [semDispositivo] = semServidor.split(':');
  return semDispositivo.replace(/\D/g, '') || null;
}

function gerarVariantesTelefoneBr(telefone) {
  const original = String(telefone ?? '');
  const variantes = [original];

  if (original.length === 12) {
    const comNove = `${original.slice(0, 4)}9${original.slice(4)}`;
    variantes.push(comNove);
  } else if (original.length === 13 && original[4] === '9') {
    const semNove = `${original.slice(0, 4)}${original.slice(5)}`;
    variantes.push(semNove);
  }

  return [...new Set(variantes)];
}

async function resolverTelefoneDoRemetente(sock, msgKey) {
  const remoteJid = msgKey?.remoteJid;
  if (!remoteJid) {
    return { telefone: null, lidNaoResolvido: false };
  }

  if (!remoteJid.endsWith('@lid')) {
    return { telefone: normalizarTelefoneDeJid(remoteJid), lidNaoResolvido: false };
  }

  const altDoEvento = msgKey.remoteJidAlt;
  if (altDoEvento && jidDecode(altDoEvento)?.server !== 'lid') {
    return { telefone: normalizarTelefoneDeJid(altDoEvento), lidNaoResolvido: false };
  }

  let pnResolvido = null;
  try {
    pnResolvido = (await sock?.signalRepository?.lidMapping?.getPNForLID?.(remoteJid)) || null;
  } catch (err) {
    console.error(`[baileysSession] falha ao resolver LID→telefone via signalRepository.lidMapping (lid=${remoteJid}):`, err);
  }

  if (pnResolvido) {
    return { telefone: normalizarTelefoneDeJid(pnResolvido), lidNaoResolvido: false };
  }

  return { telefone: null, lidNaoResolvido: true };
}

// Envelopes que o WhatsApp aninha em volta do conteúdo real da mensagem — mensagens temporárias
// (ephemeral), "ver uma vez" (viewOnce, em duas versões de payload) e combinações entre eles
// (ex.: ephemeral contendo viewOnce). Sem desembrulhar isso primeiro, `conversation`/
// `extendedTextMessage` nunca é encontrado e a mensagem cai (incorretamente) no placeholder de
// mídia — ou, antes desta correção, disparava uma exceção mais adiante que abortava o resto do
// batch (ver comentário no catch por mensagem, em handleMessagesUpsert).
const ENVELOPES_CONHECIDOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2'];
const MAX_PROFUNDIDADE_ENVELOPE = 5;

function desembrulharMensagem(message, profundidade = 0) {
  if (!message || profundidade >= MAX_PROFUNDIDADE_ENVELOPE) {
    return message ?? null;
  }

  for (const chave of ENVELOPES_CONHECIDOS) {
    const interno = message[chave]?.message;
    if (interno) {
      return desembrulharMensagem(interno, profundidade + 1);
    }
  }

  return message;
}

function extrairTextoDaMensagem(mensagemDesembrulhada, numeroRemetenteId) {
  const texto = mensagemDesembrulhada?.conversation ?? mensagemDesembrulhada?.extendedTextMessage?.text;
  if (texto != null) {
    return texto;
  }

  // Ainda não é um tipo de texto conhecido depois de desembrulhar os envelopes — pode ser mídia
  // real (comportamento já correto: cai no placeholder) ou um tipo novo/desconhecido. Logamos as
  // chaves de nível superior pra facilitar identificar rapidamente o próximo tipo não coberto,
  // sem precisar investigar do zero a partir de um "sumiço" na tabela.
  if (mensagemDesembrulhada && typeof mensagemDesembrulhada === 'object') {
    console.log(
      `[baileysSession] tipo de mensagem não reconhecido após desembrulhar envelopes ` +
      `(numeroRemetenteId=${numeroRemetenteId}); chaves de nível superior:`,
      Object.keys(mensagemDesembrulhada)
    );
  }

  return MENSAGEM_MIDIA_PLACEHOLDER;
}

async function handleMessagesUpsert(numeroRemetenteId, sock, upsert) {
  if (!upsert || upsert.type !== 'notify') {
    return;
  }

  const mensagens = Array.isArray(upsert.messages) ? upsert.messages : [];

  for (const msg of mensagens) {
    const ehDoAtendente = msg?.key?.fromMe === true;

    // Try/catch POR MENSAGEM (não só o catch de nível de batch em sock.ev.on): antes desta
    // correção, uma exceção lançada ao processar UMA mensagem do array abortava o `for...of`
    // inteiro, e todas as mensagens seguintes do mesmo batch (ex.: várias mensagens de texto em
    // sequência) nunca chegavam a ser processadas — o único rastro era um log genérico de batch,
    // sem indicar qual mensagem falhou nem por quê. Isso era a causa raiz confirmada do "sumiço
    // silencioso" relatado.
    let contatoId = null;
    try {
      const { telefone, lidNaoResolvido } = await resolverTelefoneDoRemetente(sock, msg?.key);

      if (lidNaoResolvido) {
        console.log(
          `[baileysSession] messages.upsert de LID não resolvido, mensagem ignorada ` +
          `(numeroRemetenteId=${numeroRemetenteId}, lid=${msg?.key?.remoteJid}).`
        );
        continue;
      }

      if (!telefone) {
        console.log(`[baileysSession] messages.upsert sem remoteJid utilizável (numeroRemetenteId=${numeroRemetenteId}); ignorando.`);
        continue;
      }

      contatoId = await mensagensModel.findContatoIdPorTelefoneComVariantes(gerarVariantesTelefoneBr(telefone));
      if (!contatoId) {
        console.log(
          `[baileysSession] messages.upsert de telefone sem Contato correspondente ` +
          `(numeroRemetenteId=${numeroRemetenteId}, telefone=${telefone}); ignorando.`
        );
        continue;
      }

      const mensagemDesembrulhada = desembrulharMensagem(msg?.message);

      // protocolMessage cobre vários tipos internos do WhatsApp (edição de mensagem, revogação,
      // troca de config de mensagem temporária, sincronização de histórico...). Decisão: ignorar
      // deliberadamente com log explícito, sem gravar linha nenhuma em Mensagens — diferente do
      // caso de mídia/tipo desconhecido (que sempre grava um placeholder), porque um
      // protocolMessage não é uma nova mensagem de conversa em si (é um evento sobre uma mensagem
      // já existente), e reconstruir/editar a linha original está fora do escopo desta correção.
      // O ponto crítico é que o `continue` aqui é sempre acompanhado de log — nunca um caminho
      // silencioso.
      if (mensagemDesembrulhada?.protocolMessage) {
        console.log(
          `[baileysSession] mensagem de edição (protocolMessage), ignorada nesta versão ` +
          `(numeroRemetenteId=${numeroRemetenteId}, contatoId=${contatoId}, baileysMessageId=${msg?.key?.id ?? 'null'}, ` +
          `protocolType=${mensagemDesembrulhada.protocolMessage.type ?? 'desconhecido'}).`
        );
        continue;
      }

      const corpo = extrairTextoDaMensagem(mensagemDesembrulhada, numeroRemetenteId);

      let ePrimeiraRespostaCliente;
      if (ehDoAtendente) {
        ePrimeiraRespostaCliente = false;
      } else {
        const jaTinhaMensagemDeCliente = await mensagensModel.existeMensagemClienteAnterior(contatoId);
        ePrimeiraRespostaCliente = !jaTinhaMensagemDeCliente;
      }

      const mensagemInserida = await mensagensModel.inserirMensagemRecebida({
        contatoId,
        numeroRemetenteId,
        corpo,
        baileysMessageId: msg?.key?.id ?? null,
        ePrimeiraRespostaCliente,
        remetente: ehDoAtendente ? 'atendente' : 'cliente',
      });

      if (mensagemInserida) {
        mensagensEventsService.emit('mensagem-recebida', {
          contatoId,
          numeroRemetenteId,
          primeiraResposta: Boolean(mensagemInserida.e_primeira_resposta_cliente),
        });
      }
    } catch (err) {
      console.error(
        `[baileysSession] erro ao processar mensagem individual do messages.upsert ` +
        `(numeroRemetenteId=${numeroRemetenteId}, contatoId=${contatoId ?? 'não resolvido'}, ` +
        `baileysMessageId=${msg?.key?.id ?? 'null'}):`,
        err
      );
    }
  }
}

async function abrirConexao(numeroRemetenteId, listener) {
  let sessao = sessoes.get(numeroRemetenteId);

  if (sessao) {
    sessao.listeners.add(listener);

    if (sessao.status === 'conectado') {
      listener.onConectado?.(sessao.numero);
    } else if (sessao.ultimoQr) {
      listener.onQr?.(sessao.ultimoQr);
    }
    return;
  }

  sessao = {
    sock: null,
    status: 'conectando',
    listeners: new Set([listener]),
    ultimoQr: null,
    numero: null,
    reconnectAttempts: 0,
    qrTimeoutHandle: null,
    fechando: false,
  };
  sessoes.set(numeroRemetenteId, sessao);

  try {
    await iniciarSocket(numeroRemetenteId, sessao);
  } catch (err) {
    sessoes.delete(numeroRemetenteId);
    console.error(`[baileysSession] falha ao iniciar sessão (numeroRemetenteId=${numeroRemetenteId}):`, err);
    listener.onErro?.('Não foi possível iniciar a conexão com o WhatsApp.');
  }
}

function removerListener(numeroRemetenteId, listener) {
  const sessao = sessoes.get(numeroRemetenteId);
  sessao?.listeners.delete(listener);
}


async function desconectar(numeroRemetenteId) {
  const sessao = sessoes.get(numeroRemetenteId);

  if (sessao) {
    sessao.fechando = true;
    limparTimeoutQr(sessao);
    try {
      await sessao.sock?.logout?.();
    } catch (err) {
      console.error(`[baileysSession] erro ao fazer logout (numeroRemetenteId=${numeroRemetenteId}), prosseguindo com a limpeza local:`, err);
    }
    try {
      sessao.sock?.end?.(undefined);
    } catch (err) {
    }
    sessoes.delete(numeroRemetenteId);
  }

  await removerPastaSessao(numeroRemetenteId);
}

function getStatusEmMemoria(numeroRemetenteId) {
  return sessoes.get(numeroRemetenteId)?.status ?? null;
}

function obterSocketConectado(numeroRemetenteId) {
  const sessao = sessoes.get(numeroRemetenteId);
  if (!sessao || sessao.status !== 'conectado') return null;
  return sessao.sock ?? null;
}

function aguardar(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restaurarSessaoNoBoot(numeroRemetenteId, { timeoutMs } = {}) {
  const dir = sessionDir(numeroRemetenteId);
  if (!fs.existsSync(dir)) {
    return { sucesso: false, motivo: 'pasta de sessão não encontrada em disco' };
  }

  if (sessoes.has(numeroRemetenteId)) {
    return { sucesso: true, motivo: 'sessão já ativa em memória, não sobrescrita' };
  }

  return new Promise((resolve) => {
    let resolvido = false;
    let timeoutHandle;

    const sessao = {
      sock: null,
      status: 'conectando',
      listeners: new Set(),
      ultimoQr: null,
      numero: null,
      reconnectAttempts: 0,
      qrTimeoutHandle: null,
      fechando: false,
    };

    const finalizar = (resultado) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timeoutHandle);
      resolve(resultado);
    };

    const listener = {
      onQr: () => {
        encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
        finalizar({
          sucesso: false,
          motivo: 'credenciais inválidas — o Baileys pediu um novo QR ao tentar restaurar',
        });
      },
      onConectado: () => {
        finalizar({ sucesso: true });
      },
      onErro: (mensagem) => {
        encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
        finalizar({ sucesso: false, motivo: mensagem || 'erro ao restaurar sessão' });
      },
    };
    sessao.listeners.add(listener);
    sessoes.set(numeroRemetenteId, sessao);

    timeoutHandle = setTimeout(() => {
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      finalizar({ sucesso: false, motivo: `timeout de ${timeoutMs}ms aguardando a sessão restaurar` });
    }, timeoutMs);

    iniciarSocket(numeroRemetenteId, sessao).catch((err) => {
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      finalizar({ sucesso: false, motivo: err?.message || 'erro ao iniciar socket' });
    });
  });
}

async function reconciliarSessoesNoBoot({
  delayMs = BOOT_RECONCILE_DELAY_MS,
  timeoutMs = BOOT_RECONCILE_TIMEOUT_MS,
} = {}) {
  let numerosConectados;
  try {
    numerosConectados = await numerosRemetentesModel.listNumerosPorStatusConexao('conectado');
  } catch (err) {
    console.error('[baileysSession] reconciliação de boot: falha ao consultar números "conectado" no banco:', err);
    return;
  }

  if (!numerosConectados || numerosConectados.length === 0) {
    console.log('[baileysSession] reconciliação de boot: nenhum número remetente marcado como "conectado" no banco.');
    return;
  }

  console.log(
    `[baileysSession] reconciliação de boot: ${numerosConectados.length} número(s) marcado(s) como ` +
    '"conectado" no banco; restaurando sessões em sequência...'
  );

  for (let i = 0; i < numerosConectados.length; i += 1) {
    const numeroRemetenteId = numerosConectados[i].id;

    try {
      const resultado = await restaurarSessaoNoBoot(numeroRemetenteId, { timeoutMs });

      if (resultado.sucesso) {
        console.log(`[baileysSession] boot: numeroRemetenteId=${numeroRemetenteId} número restaurado com sucesso.`);
      } else {
        console.warn(
          `[baileysSession] boot: numeroRemetenteId=${numeroRemetenteId} número marcado como desconectado, ` +
          `motivo: ${resultado.motivo}`
        );
        await numerosRemetentesModel.updateConexao(numeroRemetenteId, { numero: null, statusConexao: 'desconectado' });
        await removerPastaSessao(numeroRemetenteId);
      }
    } catch (err) {
      console.error(`[baileysSession] boot: erro inesperado restaurando numeroRemetenteId=${numeroRemetenteId}:`, err);
      try {
        await numerosRemetentesModel.updateConexao(numeroRemetenteId, { numero: null, statusConexao: 'desconectado' });
        await removerPastaSessao(numeroRemetenteId);
      } catch (err2) {
        console.error(
          `[baileysSession] boot: falha ao gravar desconexão de segurança para numeroRemetenteId=${numeroRemetenteId}:`,
          err2
        );
      }
    }

    if (i < numerosConectados.length - 1) {
      await aguardar(delayMs);
    }
  }

  console.log('[baileysSession] reconciliação de boot concluída.');
}

module.exports = {
  abrirConexao,
  removerListener,
  desconectar,
  getStatusEmMemoria,
  obterSocketConectado,
  reconciliarSessoesNoBoot,
  gerarVariantesTelefoneBr,
  desembrulharMensagem,
  extrairTextoDaMensagem,
  _baileysLib: baileysLib,
};
