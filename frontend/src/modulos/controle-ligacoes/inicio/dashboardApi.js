import { apiRequest } from '../../../lib/apiClient.js';

export function fetchDashboard(token, { estadoId, dataInicio, dataFim } = {}) {
  const params = new URLSearchParams();
  if (estadoId) params.set('estadoId', String(estadoId));
  if (dataInicio) params.set('dataInicio', dataInicio);
  if (dataFim) params.set('dataFim', dataFim);
  const query = params.toString();
  return apiRequest(
    `/api/controle-ligacoes/dashboard${query ? `?${query}` : ''}`,
    { token, cache: 'no-store' }
  );
}

export function fetchAguardandoAcao(token) {
  return apiRequest('/api/controle-ligacoes/aguardando-acao', { token, cache: 'no-store' });
}
