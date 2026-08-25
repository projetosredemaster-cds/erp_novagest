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

/**
 * Indireção sobre as duas funções do Baileys usadas neste arquivo
 * (`makeWASocket`/`useMultiFileAuthState`). Existe só para permitir troca em
 * testes: `@whiskeysockets/baileys` é um pacote ESM puro (`"type": "module"`
 * no seu `package.json`), e o `require()` desse pacote dentro do Vitest
 * devolve um objeto de namespace ESM com propriedades não-configuráveis —
 * `vi.spyOn`/`vi.mock` não conseguem substituir `makeWASocket`/
 * `useMultiFileAuthState` diretamente (erro do Vitest: "Module namespace is
 * not configurable in ESM"). Em produção, `baileysLib` sempre delega para as
 * funções reais importadas acima; em teste, `baileysSession.service.test.js`
 * faz `vi.spyOn(baileysLib, 'makeWASocket'|'useMultiFileAuthState')` neste
 * objeto (propriedades comuns de objeto literal, configuráveis).
 */
const baileysLib = {
  makeWASocket: (...args) => makeWASocket(...args),
  useMultiFileAuthState: (...args) => useMultiFileAuthState(...args),
};

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions', 'baileys');
const MAX_RECONNECT_ATTEMPTS = 3;
const QR_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutos sem o QR ser escaneado

// Reconciliação no boot (ver `reconciliarSessoesNoBoot` no final do arquivo):
// intervalo entre a tentativa de restaurar um número e o próximo, e o tempo
// máximo que se espera por cada restauração antes de desistir dela.
const BOOT_RECONCILE_DELAY_MS = 2500;
const BOOT_RECONCILE_TIMEOUT_MS = 20000;

/**
 * Gerenciamento de sessões Baileys (WhatsApp) em memória, uma por
 * `numero_remetente_id`. Este service não conhece `req`/`res` — expõe só
 * `abrirConexao`/`removerListener`/`desconectar`/`getStatusEmMemoria`, que o
 * controller usa para orquestrar as rotas HTTP/SSE.
 *
 * Decisão de design: este service persiste diretamente no banco (via
 * `numerosRemetentesModel`) as duas transições que o próprio Baileys dispara
 * de forma assíncrona e que precisam sobreviver independente de haver algum
 * cliente SSE conectado no momento em que acontecem:
 *   1. conexão confirmada (`connection === 'open'`) → grava `numero` +
 *      `status_conexao = 'conectado'`;
 *   2. reconexão automática esgotada após uma sessão que já estava
 *      'conectado' cair inesperadamente → grava `status_conexao =
 *      'desconectado'` (sem mexer em `numero`).
 * A desconexão manual (`POST .../desconectar`) é gravada pelo controller
 * (via `numerosRemetentes.service.marcarDesconectado`) depois que
 * `desconectar()` aqui confirma que a sessão foi encerrada — mantendo essa
 * ação explícita, request/response, orquestrada na camada de cima.
 *
 * Cada sessão guarda um Set de "listeners" (um por stream SSE aberto para
 * aquele numeroRemetenteId) — múltiplas abas do mesmo número reusam o MESMO
 * socket Baileys em memória (só pode haver 1 socket ativo por número) e
 * recebem os mesmos eventos via broadcast.
 */
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

  // Timeout de segurança: se ninguém escanear o QR dentro do prazo, encerra
  // a sessão em vez de deixar o socket tentando indefinidamente.
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
  if (!atual || atual !== sessao) return; // sessão já foi substituída/encerrada

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
      // Desconexão manual (fluxo `desconectar()`) — a limpeza e a gravação
      // no banco já são responsabilidade de quem chamou `desconectar()`.
      return;
    }

    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (statusCode === DisconnectReason.restartRequired) {
      // Passo normal e esperado logo após o pareamento via QR — o Baileys
      // pede um restart do socket usando as MESMAS credenciais já salvas,
      // sem que isso seja uma falha nem deva contar como tentativa de
      // reconexão nem gerar nenhum evento visível pro usuário.
      console.log(`[baileysSession] restart pós-pareamento esperado (numeroRemetenteId=${numeroRemetenteId}); reabrindo socket.`);
      await iniciarSocket(numeroRemetenteId, sessao);
      return;
    }

    if (statusCode === DisconnectReason.loggedOut) {
      // Sessão invalidada pelo próprio WhatsApp (ex.: removida no celular).
      // Não há como reconectar sem novo QR — limpa tudo e volta ao estado
      // inicial "aguardando_conexao".
      console.log(`[baileysSession] logout forçado pelo WhatsApp (numeroRemetenteId=${numeroRemetenteId}).`);
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      await removerPastaSessao(numeroRemetenteId);
      await persistirLogoutForcado(numeroRemetenteId);
      broadcastErro(sessao, 'A conexão foi encerrada pelo WhatsApp. É necessário escanear o QR novamente.');
      return;
    }

    if (sessao.status !== 'conectado') {
      // Caiu antes de completar o pareamento (ex.: QR expirado sem scan
      // completo) — não faz sentido tentar reconexão em background com um
      // QR que o usuário nunca chegou a ver/usar; encerra e deixa o
      // próximo `GET .../stream` começar um pareamento do zero.
      console.log(`[baileysSession] conexão encerrada antes de completar o pareamento (numeroRemetenteId=${numeroRemetenteId}), statusCode=${statusCode}.`);
      broadcastErro(sessao, 'Não foi possível concluir a conexão. Tente novamente.');
      encerrarSessaoEmMemoria(numeroRemetenteId, sessao);
      return;
    }

    // Sessão que já estava 'conectado' caiu inesperadamente — tenta
    // reconectar automaticamente com backoff simples antes de desistir.
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

/**
 * Normaliza um JID (`"{user}[:{device}]@{server}"`) para só os dígitos do
 * `user` — mesmo formato de `Contatos.telefone`. Remove tanto o sufixo de
 * servidor (`@s.whatsapp.net`, `@lid`, `@g.us`...) quanto um eventual sufixo
 * de dispositivo (`:0`, `:12`...) ANTES de descartar não-dígitos — sem isso,
 * um JID como `"5598999999999:0@s.whatsapp.net"` viraria
 * `"55989999999990"` (o dígito do dispositivo grudado no fim), corrompendo
 * o telefone resolvido a partir de um LID (ver `resolverTelefoneDoRemetente`
 * abaixo, que sempre devolve um JID com sufixo de dispositivo).
 */
function normalizarTelefoneDeJid(jid) {
  if (!jid) return null;
  const [semServidor] = String(jid).split('@');
  const [semDispositivo] = semServidor.split(':');
  return semDispositivo.replace(/\D/g, '') || null;
}

/**
 * Segundo bug do "mensagens do cliente não aparecem na Central de
 * Mensagens" (diferente do bug de LID acima): o servidor do WhatsApp às
 * vezes endereça a conta do remetente SEM o 9º dígito do celular brasileiro
 * (formato pré-2012) mesmo quando o número de discagem real inclui o 9 —
 * ambiguidade real do lado do WhatsApp, não um erro de captura nosso. Caso
 * real de teste: `remoteJid` chegou como "558582336124" (12 dígitos, sem o
 * 9), mas o `Contato` estava gravado como "5585982336124" (13 dígitos, com
 * o 9) — a busca exata falhava e a mensagem era descartada.
 *
 * Recebe um telefone já normalizado (só dígitos) e devolve um array com o
 * próprio telefone original sempre primeiro, mais a variante plausível
 * com/sem o 9º dígito quando o formato bate com "55" + DDD (2 dígitos) +
 * número de celular (8 dígitos) — 12 dígitos no total sem o 9, 13 com o 9.
 * Qualquer outro tamanho/formato devolve só o original (não presume DDD/
 * formato de outros países).
 */
function gerarVariantesTelefoneBr(telefone) {
  const original = String(telefone ?? '');
  const variantes = [original];

  if (original.length === 12) {
    // 55 + DD + 8 dígitos (sem o 9) → insere o 9 logo após "55DD".
    const comNove = `${original.slice(0, 4)}9${original.slice(4)}`;
    variantes.push(comNove);
  } else if (original.length === 13 && original[4] === '9') {
    // 55 + DD + 9 + 8 dígitos (com o 9) → remove o 9 da posição 4.
    const semNove = `${original.slice(0, 4)}${original.slice(5)}`;
    variantes.push(semNove);
  }

  return [...new Set(variantes)];
}

/**
 * Resolve o telefone real do remetente de uma mensagem recebida a partir de
 * `msg.key` — usado por `handleMessagesUpsert` abaixo.
 *
 * Bug corrigido (causa raiz do "mensagens recebidas não aparecem na Central
 * de Mensagens"): o WhatsApp moderno frequentemente endereça o remetente por
 * um LID (`"{id}@lid"`, um identificador interno que NÃO é o telefone) em
 * vez de `"{telefone}@s.whatsapp.net"` — extrair dígitos direto de um `@lid`
 * produz um número de ~15 dígitos que nunca bate com nenhum
 * `Contatos.telefone` (o listener descartava a mensagem, logando como se o
 * telefone tivesse sido extraído corretamente mas não encontrado na base —
 * o que não era o caso).
 *
 * Quando `remoteJid` termina em `@lid`, tenta resolver o telefone real nesta
 * ordem (confirmado contra o código-fonte da versão instalada,
 * `@whiskeysockets/baileys@7.0.0-rc14` — não presuma nomes de campo sem
 * conferir de novo se a lib for atualizada):
 *   1. `msgKey.remoteJidAlt` — quando presente, é a contrapartida em
 *      telefone/PN que o próprio Baileys já inclui no envelope da mensagem
 *      (ver `lib/Socket/messages-recv.js: handleMessage`, mesmo campo que o
 *      Baileys usa internamente para alimentar `signalRepository.lidMapping`);
 *      valida com `jidDecode` que não é, ele mesmo, outro LID antes de usar.
 *   2. `sock.signalRepository.lidMapping.getPNForLID(remoteJid)` — cache/
 *      armazenamento persistente de pares LID↔PN que o Baileys mantém por
 *      conta própria; só resolve se algum evento anterior já tiver
 *      alimentado esse mapeamento para este remetente.
 * Se nenhuma das duas resolver, devolve `{ telefone: null, lidNaoResolvido:
 * true }` — sinal para o chamador logar "LID não resolvido" em vez de
 * "telefone sem Contato correspondente" (são causas bem diferentes).
 */
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

/**
 * Extrai o texto de uma mensagem Baileys recebida — só os dois formatos de
 * texto simples são suportados nesta fase (`conversation`/
 * `extendedTextMessage.text`); qualquer outro tipo (mídia: áudio, imagem,
 * etc.) vira um placeholder fixo.
 */
function extrairTextoDaMensagem(msg) {
  const texto = msg?.message?.conversation ?? msg?.message?.extendedTextMessage?.text;
  return texto ?? MENSAGEM_MIDIA_PLACEHOLDER;
}

/**
 * Handler de `messages.upsert` (Central de Mensagens — ver
 * CONTRATO-CONTROLE-LIGACOES-API.md, seção "Central de Mensagens (v7)").
 *
 * Só processa eventos `type === 'notify'` (mensagem nova, em tempo real) —
 * o Baileys também emite `messages.upsert` com `type: 'append'` durante
 * sincronização de histórico (acontece sobretudo quando uma sessão é
 * restaurada na reconciliação de boot), e processar isso inundaria
 * `Mensagens` com histórico antigo toda vez que o processo reinicia.
 *
 * Ignora mensagens com `key.fromMe === true` (eco de mensagem que nós
 * mesmos enviamos — já gravada explicitamente pelos fluxos de envio,
 * gravar de novo duplicaria) e mensagens cujo telefone não corresponde a
 * nenhum `Contato` conhecido (número fora da nossa base, ou é um grupo).
 * A busca do Contato tenta o telefone recebido e, quando aplicável, a
 * variante com/sem o 9º dígito (ver `gerarVariantesTelefoneBr` acima) antes
 * de desistir. `sock` é necessário para resolver telefone a partir de um
 * `@lid` (ver `resolverTelefoneDoRemetente`).
 *
 * Quando a mensagem é de fato inserida (não descartada por dedup — ver
 * `mensagens.model.js: inserirMensagemRecebida`, que retorna `null` nesse
 * caso), emite `'mensagem-recebida'` em `mensagensEvents.service.js` para o
 * SSE de `GET /conversas/stream` (Central de Mensagens) repassar em tempo
 * real a quem estiver com a tela de Conversas aberta.
 *
 * **Ordem importante**: antes de inserir, checa
 * `mensagensModel.existeMensagemClienteAnterior(contatoId)` — se o contato
 * NUNCA teve nenhuma mensagem de cliente até agora, esta é a "primeira
 * resposta do cliente" (handoff IA→humano), e isso é gravado na coluna
 * `e_primeira_resposta_cliente` (ver `mensagens.model.js`), fonte do sino de
 * notificações do frontend (`GET /notificacoes`). Essa checagem precisa
 * acontecer ANTES do `INSERT`, nunca depois — checar depois sempre
 * encontraria a própria linha recém-gravada e nunca marcaria nada como
 * primeira resposta. O payload do evento emitido usa o valor devolvido pelo
 * `OUTPUT` do `INSERT` (`mensagemInserida.e_primeira_resposta_cliente`), não
 * a variável local calculada aqui — evita qualquer discrepância caso o
 * `OUTPUT` normalize o tipo `BIT` de forma diferente do booleano JS enviado.
 */
async function handleMessagesUpsert(numeroRemetenteId, sock, upsert) {
  if (!upsert || upsert.type !== 'notify') {
    return;
  }

  const mensagens = Array.isArray(upsert.messages) ? upsert.messages : [];

  for (const msg of mensagens) {
    if (msg?.key?.fromMe === true) {
      continue;
    }

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

    const contatoId = await mensagensModel.findContatoIdPorTelefoneComVariantes(gerarVariantesTelefoneBr(telefone));
    if (!contatoId) {
      console.log(
        `[baileysSession] messages.upsert de telefone sem Contato correspondente ` +
        `(numeroRemetenteId=${numeroRemetenteId}, telefone=${telefone}); ignorando.`
      );
      continue;
    }

    const corpo = extrairTextoDaMensagem(msg);

    const jaTinhaMensagemDeCliente = await mensagensModel.existeMensagemClienteAnterior(contatoId);
    const ePrimeiraRespostaCliente = !jaTinhaMensagemDeCliente;

    const mensagemInserida = await mensagensModel.inserirMensagemRecebida({
      contatoId,
      numeroRemetenteId,
      corpo,
      baileysMessageId: msg?.key?.id ?? null,
      ePrimeiraRespostaCliente,
    });

    if (mensagemInserida) {
      mensagensEventsService.emit('mensagem-recebida', {
        contatoId,
        numeroRemetenteId,
        primeiraResposta: Boolean(mensagemInserida.e_primeira_resposta_cliente),
      });
    }
  }
}

/**
 * Abre (ou reaproveita, se já existir em memória) a sessão Baileys de um
 * número remetente e registra `listener` para receber os eventos dela.
 *
 * `listener` = `{ onQr(qr), onConectado(numero), onErro(mensagem) }` —
 * todos opcionais. Chame `removerListener` no `close` da resposta HTTP
 * correspondente para não vazar listeners.
 */
async function abrirConexao(numeroRemetenteId, listener) {
  let sessao = sessoes.get(numeroRemetenteId);

  if (sessao) {
    sessao.listeners.add(listener);

    // Replay do último QR conhecido (ou do "conectado", numa corrida rara em
    // que a conexão fechou entre a checagem do controller e este momento),
    // para uma 2ª aba não esperar até 20s pelo próximo QR do zero.
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

/**
 * Remove um listener específico (ex.: cliente SSE fechou a aba) sem encerrar
 * a sessão Baileys em memória — outra aba pode continuar aguardando o mesmo
 * QR/conexão.
 */
function removerListener(numeroRemetenteId, listener) {
  const sessao = sessoes.get(numeroRemetenteId);
  sessao?.listeners.delete(listener);
}

/**
 * Encerra de fato a sessão Baileys de um número (logout explícito) e apaga a
 * pasta de credenciais em disco. Não grava nada no banco — quem chama esta
 * função é responsável por persistir a transição de estado (ver
 * `numerosRemetentes.service.marcarDesconectado`).
 */
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
      // socket pode já ter sido encerrado pelo próprio logout(); ignora.
    }
    sessoes.delete(numeroRemetenteId);
  }

  await removerPastaSessao(numeroRemetenteId);
}

/**
 * Status da sessão tal como conhecido em memória agora (não é o mesmo que o
 * `status_conexao` do banco — é só pra decisões internas/depuração).
 */
function getStatusEmMemoria(numeroRemetenteId) {
  return sessoes.get(numeroRemetenteId)?.status ?? null;
}

/**
 * Devolve o socket Baileys ativo de um número remetente, só se a sessão
 * estiver de fato `'conectado'` em memória agora — usado pelo worker de
 * envio (`workers/envioDisparos.worker.js`) para chamar
 * `sock.sendMessage(...)`. Retorna `null` se não houver sessão em memória, ou
 * se ela existir mas ainda não tiver completado o pareamento (ex.:
 * `'conectando'`), para nunca devolver um socket que ainda não está pronto
 * para enviar mensagem.
 */
function obterSocketConectado(numeroRemetenteId) {
  const sessao = sessoes.get(numeroRemetenteId);
  if (!sessao || sessao.status !== 'conectado') return null;
  return sessao.sock ?? null;
}

function aguardar(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tenta restaurar, a partir das credenciais já salvas em disco, a sessão
 * Baileys de um único número remetente durante o boot do processo.
 *
 * Reaproveita exatamente o mesmo caminho de abertura de socket que o fluxo
 * de pareamento por QR já usa (`iniciarSocket`/`handleConnectionUpdate`) —
 * a diferença é só que aqui ninguém está esperando um QR: se o Baileys
 * conseguir reconectar com as credenciais existentes, a conexão fecha em
 * `connection === 'open'` sem nunca emitir `qr`; se emitir `qr` mesmo assim,
 * é sinal de que a credencial não é mais válida, e isso é tratado como falha
 * de restauração (não fica esperando alguém escanear no boot).
 *
 * Resolve sempre com `{ sucesso: boolean, motivo?: string }` — nunca rejeita.
 */
async function restaurarSessaoNoBoot(numeroRemetenteId, { timeoutMs } = {}) {
  const dir = sessionDir(numeroRemetenteId);
  if (!fs.existsSync(dir)) {
    return { sucesso: false, motivo: 'pasta de sessão não encontrada em disco' };
  }

  if (sessoes.has(numeroRemetenteId)) {
    // Já existe uma sessão em memória para este número (ex.: alguém abriu o
    // stream de conexão manualmente antes da rotina de boot chegar nele) —
    // não sobrescreve uma sessão já em andamento.
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

/**
 * Roda uma única vez no boot do processo: busca todo `NumerosRemetentes`
 * que o banco ainda diz estar `'conectado'` (valor gravado antes de um
 * possível restart do processo, quando a sessão Baileys em memória — o Map
 * `sessoes` — se perdeu) e tenta restaurar cada sessão a partir das
 * credenciais salvas em disco, em sequência (nunca em paralelo, para não
 * abrir várias conexões Baileys de uma vez no boot).
 *
 * Números restaurados com sucesso permanecem `'conectado'` (o próprio
 * `persistirConectado`, chamado pela mesma máquina de eventos de sempre,
 * já cuida disso). Números cuja restauração falha (pasta ausente,
 * credencial inválida, timeout, logout/erro definitivo do Baileys) são
 * gravados como `'desconectado'`/`numero=NULL` e têm a pasta de sessão
 * órfã removida do disco.
 *
 * `delayMs`/`timeoutMs` são parâmetros só para permitir testes rápidos
 * (produção usa os defaults `BOOT_RECONCILE_DELAY_MS`/`BOOT_RECONCILE_TIMEOUT_MS`).
 * Nunca rejeita — qualquer erro inesperado é capturado e logado, para não
 * arriscar a estabilidade do boot do processo.
 */
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
  // Exportado só para `baileysSession.service.test.js` conseguir
  // `vi.spyOn(baileysLib, ...)` (ver comentário acima de `baileysLib`) — não
  // é parte da API pública deste service, nenhum outro módulo deve importar
  // isto.
  _baileysLib: baileysLib,
};
