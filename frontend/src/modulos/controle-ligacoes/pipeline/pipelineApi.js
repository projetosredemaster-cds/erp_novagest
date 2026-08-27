import { apiRequest } from '../../../lib/apiClient.js';

export { atualizarStatusConversa } from '../conversas/conversasApi.js';

export function fetchPipeline(token, { busca, numeroRemetenteId, statusInicio, statusFim, disparoInicio, disparoFim } = {}) {
  const params = new URLSearchParams();
  if (busca) params.set('busca', busca);
  if (numeroRemetenteId) params.set('numeroRemetenteId', String(numeroRemetenteId));
  if (statusInicio) params.set('statusInicio', statusInicio);
  if (statusFim) params.set('statusFim', statusFim);
  if (disparoInicio) params.set('disparoInicio', disparoInicio);
  if (disparoFim) params.set('disparoFim', disparoFim);
  const query = params.toString();
  return apiRequest(
    `/api/controle-ligacoes/pipeline${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

export function fetchHistoricoStatus(token, contatoId, numeroRemetenteId) {
  return apiRequest(
    `/api/controle-ligacoes/pipeline/${contatoId}/${numeroRemetenteId}/historico`,
    { token, cache: 'no-store' }
  );
}
