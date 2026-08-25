import { apiRequest } from '../../../lib/apiClient.js';

function buildFiltrosQuery(filtros = {}) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    params.set(chave, valor);
  });
  return params.toString();
}

export function fetchPainelDisparo(token) {
  return apiRequest('/api/controle-ligacoes/painel-disparo', { token, cache: 'no-store' });
}

export function fetchContatosDisponiveis(token, estadoId, filtros = {}) {
  const query = buildFiltrosQuery(filtros);
  return apiRequest(
    `/api/controle-ligacoes/estados/${estadoId}/contatos-disponiveis${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

export function verificarDisparo(token, { estadoId, numeroRemetenteId, contatoIds }) {
  return apiRequest('/api/controle-ligacoes/disparos/verificar', {
    method: 'POST',
    body: JSON.stringify({ estadoId, numeroRemetenteId, contatoIds }),
    token,
  });
}

export function criarDisparo(token, { estadoId, numeroRemetenteId, contatoIds }) {
  return apiRequest('/api/controle-ligacoes/disparos', {
    method: 'POST',
    body: JSON.stringify({ estadoId, numeroRemetenteId, contatoIds }),
    token,
  });
}
