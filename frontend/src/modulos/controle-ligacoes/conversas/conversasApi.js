// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API da Central de Mensagens (CONTRATO-CONTROLE-LIGACOES-API.md,
// seção "Central de Mensagens (v7)"). Fica dentro de
// modulos/controle-ligacoes/conversas por ser exclusivo desta tela, mesmo
// padrão de painelDisparoApi.js/controleLigacoesConfigApi.js. `token` é
// sempre passado explicitamente pelo componente chamador (via
// `useAuth().token`).
import { apiRequest } from '../../../lib/apiClient.js';

// `cache: 'no-store'`: mesmo raciocínio do Painel de Disparo — a lista de
// conversas (não lidas, última mensagem) muda a cada poucos segundos e não
// deve ser servida do cache HTTP do navegador.
export function fetchConversas(token, { busca, apenasNaoLidas } = {}) {
  const params = new URLSearchParams();
  if (busca) params.set('busca', busca);
  if (apenasNaoLidas) params.set('apenasNaoLidas', 'true');
  const query = params.toString();
  return apiRequest(
    `/api/controle-ligacoes/conversas${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

// Efeito colateral importante (documentado no contrato): esta chamada marca
// como lida, no servidor, toda mensagem `remetente='cliente'` ainda não lida
// daquele contato — quem chama (ConversasPage) deve zerar `naoLidas` do item
// correspondente na lista local em seguida, sem esperar um novo GET.
// Contagem de conversas com uma "primeira resposta do cliente" (handoff
// IA→humano) ainda não vista pelo operador — consumida pelo sino de
// notificações do shell (ControleLigacoesShell.jsx), não por esta tela.
// `cache: 'no-store'` pelo mesmo motivo das demais chamadas acima: é uma
// contagem dinâmica, não deve ser servida do cache HTTP do navegador.
export function fetchNotificacoes(token) {
  return apiRequest('/api/controle-ligacoes/notificacoes', { token, cache: 'no-store' });
}

// Resposta: `{ mensagens: [...], numeroRemetenteInicial: {id, apelido}|null }`.
// `numeroRemetenteInicial` é o número que mandou a primeira mensagem dessa
// conversa (histórico, não muda) — usado por ConversasPage.jsx para deixar
// claro no cabeçalho do chat quando o número que iniciou a conversa é
// diferente do número em uso agora (`numeroRemetenteAtual`, que não vem
// nesta resposta — o componente pega esse dado da lista `conversas` já
// carregada via fetchConversas, que é quem tem esse campo).
export function fetchMensagens(token, contatoId) {
  return apiRequest(
    `/api/controle-ligacoes/conversas/${contatoId}/mensagens`,
    { token, cache: 'no-store' }
  );
}

export function enviarMensagem(token, contatoId, corpo) {
  return apiRequest(`/api/controle-ligacoes/conversas/${contatoId}/mensagens`, {
    method: 'POST',
    body: JSON.stringify({ corpo }),
    token,
  });
}

// --- Tempo real (SSE) ---
// `GET /conversas/stream` fica aberto indefinidamente (só fecha quando o
// cliente desconectar) e emite `event: nova-mensagem` / `data: {contatoId,
// numeroRemetenteId}` a cada mensagem nova de cliente — sem corpo, é só
// sinal para re-buscar via `fetchConversas`/`fetchMensagens` acima. Mesmo
// motivo/padrão de `abrirStreamConexao` em controleLigacoesConfigApi.js: o
// `EventSource` nativo do browser não permite enviar o header
// `Authorization` que a API exige (sem fallback de token por query string),
// então o stream é consumido via `fetch` (que já envia o header
// normalmente) + leitura manual do corpo (`response.body.getReader()` +
// `TextDecoder`) com parsing manual do formato SSE (linhas `event:`/`data:`,
// eventos separados por linha em branco). Não reaproveita `parseSseEvent`
// de controleLigacoesConfigApi.js — cada tela tem seu próprio `<modulo>Api.js`
// isolado, mesma convenção do resto do projeto.
//
// `onEvent(event, data)` é chamado a cada evento SSE completo recebido.
// `signal` (AbortController) permite cancelar a leitura a qualquer momento
// (desmonte do componente, reconexão).
export async function abrirStreamConversas(token, { onEvent, signal } = {}) {
  const baseUrl = import.meta.env.VITE_API_URL;
  const response = await fetch(`${baseUrl}/api/controle-ligacoes/conversas/stream`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error || `Erro ao abrir conexão em tempo real (${response.status}).`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseSseEventConversas(rawEvent);
      if (parsed) onEvent?.(parsed.event, parsed.data);
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

function parseSseEventConversas(rawEvent) {
  let eventName = 'message';
  const dataLines = [];

  for (const rawLine of rawEvent.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    return { event: eventName, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event: eventName, data: null };
  }
}
