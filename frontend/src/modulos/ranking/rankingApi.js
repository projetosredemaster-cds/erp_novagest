// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API real do módulo Ranking.
// Isola todas as chamadas fetch para manter RankingPage.jsx focado em UI/estado.
// Todas as rotas de /api/ranking/* exigem autenticação — `apiRequest` (ver
// src/lib/apiClient.js) já anexa o header `Authorization: Bearer <token>`
// lendo o token salvo (mesmo lugar que AuthContext usa) e dispara o logout
// global se a API responder 401 (token ausente/expirado).
//
// CRUD de Diretor/Rede/Responsavel foi extraído para src/lib/cadastrosApi.js
// (cadastro compartilhado com o módulo Margens) — ver CONTRATO-RANKING-API.md
// v3 e CONTRATO-CADASTROS-API.md. Este arquivo é dono só de
// Categorias/Entradas e do envio de relatório por e-mail.
import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchCategorias() {
  return request('/api/ranking/categorias');
}

export function criarCategoria({ nome }) {
  return request('/api/ranking/categorias', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function atualizarCategoria(id, { nome, visivel }) {
  return request(`/api/ranking/categorias/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, visivel }),
  });
}

export function removerCategoria(id) {
  return request(`/api/ranking/categorias/${id}`, { method: 'DELETE' });
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

export function removerEntrada({ data, categoriaId, redeId }) {
  const params = new URLSearchParams({
    data,
    categoriaId: String(categoriaId),
    redeId: String(redeId),
  });
  return request(`/api/ranking/entradas?${params.toString()}`, { method: 'DELETE' });
}

export function enviarRelatorioPorEmail({ texto, assunto }) {
  return request('/api/ranking/relatorio/email', {
    method: 'POST',
    body: JSON.stringify({ texto, assunto }),
  });
}
