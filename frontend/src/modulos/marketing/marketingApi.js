// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API real do módulo Marketing (ver CONTRATO-MARKETING-API.md).
// Cuida só do que é exclusivo do Marketing (lançamento mensal de faturamento
// geral/marketing/retorno-indicação por loja) — CRUD de Diretor/Rede/Loja é
// cadastro compartilhado e vive em src/lib/cadastrosApi.js. `apiRequest` (ver
// src/lib/apiClient.js) já anexa o header `Authorization: Bearer <token>` e
// dispara o logout global em respostas 401 — não implementar tratamento de 401
// aqui.
import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

// GET /api/marketing/entradas?ano=YYYY&mes=MM — array de blocos
// { diretor, rede, lojas[] } (ver seção 1 de CONTRATO-MARKETING-API.md).
export function fetchEntradas({ ano, mes }) {
  const params = new URLSearchParams({ ano: String(ano), mes: String(mes) });
  return request(`/api/marketing/entradas?${params.toString()}`);
}

// POST /api/marketing/entradas — upsert por (ano, mes, lojaId); os 5 campos
// abaixo são TODOS obrigatórios no backend (ver seção 2 de
// CONTRATO-MARKETING-API.md) — quem chama esta função precisa sempre montar o
// objeto com os 3 valores de faturamento da linha inteira, não só o campo que
// perdeu foco.
export function salvarEntrada({ lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }) {
  return request('/api/marketing/entradas', {
    method: 'POST',
    body: JSON.stringify({ lojaId, ano, mes, faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao }),
  });
}
