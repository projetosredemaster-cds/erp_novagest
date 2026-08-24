// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do módulo Controle de Ligações — Estados e Números
// Remetentes (CONTRATO-CONTROLE-LIGACOES-API.md, seções 3 a 8). Fica dentro
// de modulos/controle-ligacoes/configuracoes por ser exclusivo deste módulo
// isolado (diferente de cadastrosApi.js, que é compartilhado entre módulos
// do ERP normal). `token` é sempre passado explicitamente pelo componente
// chamador (via `useAuth().token`), mesmo padrão de authApi.js/UsuariosPage.
import { apiRequest } from '../../../lib/apiClient.js';

export function fetchEstados(token) {
  return apiRequest('/api/controle-ligacoes/estados', { token });
}

export function criarEstado(token, { nome, uf, ddds }) {
  return apiRequest('/api/controle-ligacoes/estados', {
    method: 'POST',
    body: JSON.stringify({ nome, uf, ddds }),
    token,
  });
}

export function fetchNumerosRemetentes(token) {
  return apiRequest('/api/controle-ligacoes/numeros-remetentes', { token });
}

export function criarNumeroRemetente(token, { apelido, estadoId }) {
  return apiRequest('/api/controle-ligacoes/numeros-remetentes', {
    method: 'POST',
    body: JSON.stringify({ apelido, estadoId }),
    token,
  });
}

// Atualização parcial (seção 7 do contrato): envia só os campos informados.
// `nomeColaboradora` segue o mesmo padrão condicional dos demais campos —
// omitir não altera nada; string vazia/`null` é repassada como está (o
// backend já normaliza pra `null`, ver PUT /numeros-remetentes/:id).
export function atualizarNumeroRemetente(token, id, { apelido, estadoId, ativo, nomeColaboradora } = {}) {
  const body = {};
  if (apelido !== undefined) body.apelido = apelido;
  if (estadoId !== undefined) body.estadoId = estadoId;
  if (ativo !== undefined) body.ativo = ativo;
  if (nomeColaboradora !== undefined) body.nomeColaboradora = nomeColaboradora;

  return apiRequest(`/api/controle-ligacoes/numeros-remetentes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    token,
  });
}

export function removerNumeroRemetente(token, id) {
  return apiRequest(`/api/controle-ligacoes/numeros-remetentes/${id}`, { method: 'DELETE', token });
}

// Sem corpo; devolve o número remetente atualizado no mesmo formato do PUT.
export function desconectarNumeroRemetente(token, id) {
  return apiRequest(`/api/controle-ligacoes/numeros-remetentes/${id}/conexao/desconectar`, {
    method: 'POST',
    token,
  });
}

// --- Conexão WhatsApp via Baileys (SSE) ---
// O `EventSource` nativo do browser não permite enviar headers customizados,
// e a API autentica via `Authorization: Bearer <token>` (sem fallback de
// token por query string). Por isso este stream é consumido via `fetch`
// (que já envia o header Authorization normalmente, igual a qualquer outra
// chamada do projeto) + leitura manual do corpo como stream
// (`response.body.getReader()` + `TextDecoder`), com parsing manual do
// formato SSE (linhas `event: <nome>` / `data: <json>`, eventos separados
// por linha em branco). Não usar `new EventSource(...)` aqui — falharia
// silenciosamente com 401 (sem header nenhum).
//
// Não passa por `apiRequest` (que sempre faz `await response.json()` no
// fim, incompatível com um corpo de stream contínuo).
//
// `onEvent(event, data)` é chamado a cada evento SSE completo recebido.
// `signal` (AbortController) permite cancelar a leitura a qualquer momento
// (fechar o modal, desmontar o componente) — ver ConexaoWhatsAppModal em
// NumerosRemetentesPage.jsx.
export async function abrirStreamConexao(token, id, { onEvent, signal } = {}) {
  const baseUrl = import.meta.env.VITE_API_URL;
  const response = await fetch(`${baseUrl}/api/controle-ligacoes/numeros-remetentes/${id}/conexao/stream`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error || `Erro ao abrir conexão (${response.status}).`);
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
      const parsed = parseSseEvent(rawEvent);
      if (parsed) onEvent?.(parsed.event, parsed.data);
      separatorIndex = buffer.indexOf('\n\n');
    }
  }
}

function parseSseEvent(rawEvent) {
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
