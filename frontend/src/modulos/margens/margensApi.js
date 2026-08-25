import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchEntradas(data) {
  const params = new URLSearchParams({ data });
  return request(`/api/margens/entradas?${params.toString()}`);
}

export function salvarEntrada({ data, lojaId, faturamento, custoProduto, totalTar, margemInformada }) {
  const body = { data, lojaId, faturamento, custoProduto, totalTar };

  if (margemInformada !== undefined && margemInformada !== null) {
    body.margemInformada = margemInformada;
  }
  return request('/api/margens/entradas', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchRelatorio(dataInicio, dataFim) {
  const params = new URLSearchParams({ dataInicio, dataFim });
  return request(`/api/margens/relatorio?${params.toString()}`);
}
