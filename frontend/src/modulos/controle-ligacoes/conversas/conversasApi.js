import { apiRequest } from '../../../lib/apiClient.js';

export function fetchConversas(token, { busca, apenasNaoLidas, numeroRemetenteId, status } = {}) {
  const params = new URLSearchParams();
  if (busca) params.set('busca', busca);
  if (apenasNaoLidas) params.set('apenasNaoLidas', 'true');
  if (numeroRemetenteId) params.set('numeroRemetenteId', String(numeroRemetenteId));
  if (status) params.set('status', status);
  const query = params.toString();
  return apiRequest(
    `/api/controle-ligacoes/conversas${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

export function fetchNotificacoes(token) {
  return apiRequest('/api/controle-ligacoes/notificacoes', { token, cache: 'no-store' });
}

export function fetchMensagens(token, contatoId, numeroRemetenteId) {
  return apiRequest(
    `/api/controle-ligacoes/conversas/${contatoId}/${numeroRemetenteId}/mensagens`,
    { token, cache: 'no-store' }
  );
}

export function enviarMensagem(token, contatoId, numeroRemetenteId, corpo) {
  return apiRequest(`/api/controle-ligacoes/conversas/${contatoId}/${numeroRemetenteId}/mensagens`, {
    method: 'POST',
    body: JSON.stringify({ corpo }),
    token,
  });
}

export function atualizarStatusConversa(token, contatoId, numeroRemetenteId, status) {
  return apiRequest(`/api/controle-ligacoes/conversas/${contatoId}/${numeroRemetenteId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
    token,
  });
}


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
