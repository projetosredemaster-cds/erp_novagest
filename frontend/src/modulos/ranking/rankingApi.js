// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso à API real do módulo Ranking.
// Isola todas as chamadas fetch para manter RankingPage.jsx focado em UI/estado.
// Todas as rotas de /api/ranking/* exigem autenticação — `apiRequest` (ver
// src/lib/apiClient.js) já anexa o header `Authorization: Bearer <token>`
// lendo o token salvo (mesmo lugar que AuthContext usa) e dispara o logout
// global se a API responder 401 (token ausente/expirado).
import { apiRequest } from '../../lib/apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchRedes() {
  return request('/api/ranking/redes');
}

export function fetchCategorias() {
  return request('/api/ranking/categorias');
}

export function fetchEntradas(data, categoriaId) {
  const params = new URLSearchParams({ data, categoriaId: String(categoriaId) });
  return request(`/api/ranking/entradas?${params.toString()}`);
}

export function salvarEntrada({ data, categoriaId, lojaId, valor }) {
  return request('/api/ranking/entradas', {
    method: 'POST',
    body: JSON.stringify({ data, categoriaId, lojaId, valor }),
  });
}

export function criarRede({ nome, responsavel }) {
  return request('/api/ranking/redes', {
    method: 'POST',
    body: JSON.stringify({ nome, responsavel }),
  });
}

export function atualizarRede(id, { nome, responsavel }) {
  return request(`/api/ranking/redes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, responsavel }),
  });
}

export function removerRede(id) {
  return request(`/api/ranking/redes/${id}`, { method: 'DELETE' });
}

export function criarLoja({ redeId, nome, emoji }) {
  return request('/api/ranking/lojas', {
    method: 'POST',
    body: JSON.stringify({ redeId, nome, emoji }),
  });
}

export function atualizarLoja(id, { nome, emoji, ativo }) {
  return request(`/api/ranking/lojas/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, emoji, ativo }),
  });
}

export function removerLoja(id) {
  return request(`/api/ranking/lojas/${id}`, { method: 'DELETE' });
}

export function enviarRelatorioPorEmail({ texto, assunto }) {
  return request('/api/ranking/relatorio/email', {
    method: 'POST',
    body: JSON.stringify({ texto, assunto }),
  });
}