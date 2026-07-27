// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API real do módulo Ranking.
// Isola todas as chamadas fetch para manter RankingPage.jsx focado em UI/estado.
// Todas as rotas de /api/ranking/* exigem autenticação — `apiRequest` (ver
// src/lib/apiClient.js) já anexa o header `Authorization: Bearer <token>`
// lendo o token salvo (mesmo lugar que AuthContext usa) e dispara o logout
// global se a API responder 401 (token ausente/expirado).
//
// Hierarquia de dados (ver CONTRATO-RANKING-API.md v2): Diretor -> Rede.
// O Ranking nunca opera no nível Loja física (tabela `Lojas`, usada só pelo
// módulo Margens) — "rede" aqui sempre se refere à antiga "loja" do modelo
// de 2 níveis (Delta, Lendários...), agora aninhada dentro de um Diretor.
import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchDiretores() {
  return request('/api/ranking/diretores');
}

export function fetchCategorias() {
  return request('/api/ranking/categorias');
}

export function fetchEntradas(data, categoriaId) {
  const params = new URLSearchParams({ data, categoriaId: String(categoriaId) });
  return request(`/api/ranking/entradas?${params.toString()}`);
}

export function salvarEntrada({ data, categoriaId, redeId, valor }) {
  return request('/api/ranking/entradas', {
    method: 'POST',
    body: JSON.stringify({ data, categoriaId, redeId, valor }),
  });
}

export function criarDiretor({ nome }) {
  return request('/api/ranking/diretores', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function atualizarDiretor(id, { nome }) {
  return request(`/api/ranking/diretores/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome }),
  });
}

export function removerDiretor(id) {
  return request(`/api/ranking/diretores/${id}`, { method: 'DELETE' });
}

export function criarRede({ diretorId, nome, emoji }) {
  return request('/api/ranking/redes', {
    method: 'POST',
    body: JSON.stringify({ diretorId, nome, emoji }),
  });
}

export function atualizarRede(id, { nome, emoji, responsavelId, ativo, visivel }) {
  return request(`/api/ranking/redes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, emoji, responsavelId, ativo, visivel }),
  });
}

export function removerRede(id) {
  return request(`/api/ranking/redes/${id}`, { method: 'DELETE' });
}

export function enviarRelatorioPorEmail({ texto, assunto }) {
  return request('/api/ranking/relatorio/email', {
    method: 'POST',
    body: JSON.stringify({ texto, assunto }),
  });
}

export function fetchResponsaveis() {
  return request('/api/ranking/responsaveis');
}

export function criarResponsavel({ nome }) {
  return request('/api/ranking/responsaveis', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function removerResponsavel(id) {
  return request(`/api/ranking/responsaveis/${id}`, { method: 'DELETE' });
}
