// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API real do módulo Margens.
// Cuida só do que é exclusivo do Margens (lançamentos diários de margem e
// relatório de período) — CRUD de Diretor/Rede/Loja/Responsavel é cadastro
// compartilhado e vive em src/lib/cadastrosApi.js (ver CONTRATO-MARGENS-API.md
// e CONTRATO-CADASTROS-API.md). `apiRequest` (ver src/lib/apiClient.js) já
// anexa o header `Authorization: Bearer <token>` e dispara o logout global
// em respostas 401.
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
  // só inclui a chave quando informada — campo ausente/undefined/null mantém o formato
  // de hoje idêntico no caminho "só Total Tar" (o backend trata ausência como "não
  // informado" e grava franquia=0, ver CONTRATO-MARGENS-API.md).
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
