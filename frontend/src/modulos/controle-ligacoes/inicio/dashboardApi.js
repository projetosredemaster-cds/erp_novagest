import { apiRequest } from '../../../lib/apiClient.js';

export function fetchDashboard(token, estadoId) {
  return apiRequest(
    `/api/controle-ligacoes/dashboard${estadoId ? `?estadoId=${estadoId}` : ''}`,
    { token, cache: 'no-store' }
  );
}
