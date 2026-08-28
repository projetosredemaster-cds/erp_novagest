import { apiRequest } from '../../../lib/apiClient.js';

export function importarContatos(token, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);

  return apiRequest('/api/controle-ligacoes/contatos/importar', {
    method: 'POST',
    body: formData,
    token,
  });
}

export function fetchHistoricoImportacoes(token) {
  return apiRequest('/api/controle-ligacoes/contatos/importar/historico', { token });
}

export function fetchDetalheImportacao(token, loteId) {
  return apiRequest(`/api/controle-ligacoes/contatos/importar/${loteId}`, { token });
}
