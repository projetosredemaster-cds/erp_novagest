import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchEntradas({ ano, mes }) {
  const params = new URLSearchParams({ ano: String(ano), mes: String(mes) });
  return request(`/api/marketing/entradas?${params.toString()}`);
}

export function salvarEntrada({ lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }) {
  return request('/api/marketing/entradas', {
    method: 'POST',
    body: JSON.stringify({ lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }),
  });
}

export function removerEntrada({ ano, mes, lojaId }) {
  const params = new URLSearchParams({ ano: String(ano), mes: String(mes), lojaId: String(lojaId) });
  return request(`/api/marketing/entradas?${params.toString()}`, { method: 'DELETE' });
}
