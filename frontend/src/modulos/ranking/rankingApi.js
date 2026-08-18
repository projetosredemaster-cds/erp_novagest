
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
