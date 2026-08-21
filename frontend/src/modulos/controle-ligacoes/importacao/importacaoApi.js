// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API do módulo Controle de Ligações — Importação de
// contatos (CONTRATO-CONTROLE-LIGACOES-API.md, seções 9 a 11). `token`
// sempre passado explicitamente pelo componente chamador.
import { apiRequest } from '../../../lib/apiClient.js';

// multipart/form-data — o campo é sempre "arquivo" (seção 9 do contrato).
// `apiClient.js` já sabe omitir o Content-Type fixo quando o body é FormData.
export function importarContatos(token, arquivo) {
  const formData = new FormData();
  formData.append('arquivo', arquivo);

  return apiRequest('/api/controle-ligacoes/contatos/importar', {
    method: 'POST',
    body: formData,
    token,
  });
}

export function confirmarImportacao(token, loteImportacaoId, escolhas) {
  return apiRequest(`/api/controle-ligacoes/contatos/importar/${loteImportacaoId}/confirmar`, {
    method: 'POST',
    body: JSON.stringify({ escolhas }),
    token,
  });
}

export function fetchImportacoesPendentes(token) {
  return apiRequest('/api/controle-ligacoes/contatos/importar/pendentes', { token });
}
