import { apiRequest } from '../../../lib/apiClient.js';

export function fetchFalhasEnvio(token) {
  return apiRequest('/api/controle-ligacoes/disparos/falhas', { token, cache: 'no-store' });
}

export function reenviarDisparoContato(token, disparoContatoId) {
  return apiRequest(`/api/controle-ligacoes/disparos/contatos/${disparoContatoId}/reenviar`, {
    method: 'PUT',
    token,
  });
}

export function ignorarDisparoContato(token, disparoContatoId) {
  return apiRequest(`/api/controle-ligacoes/disparos/contatos/${disparoContatoId}/ignorar`, {
    method: 'PUT',
    token,
  });
}
