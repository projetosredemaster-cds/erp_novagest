import { apiRequest } from './apiClient.js';

function request(path, options) {
  return apiRequest(path, options);
}

export function fetchDiretores() {
  return request('/api/cadastros/diretores');
}

export function criarDiretor({ nome }) {
  return request('/api/cadastros/diretores', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function atualizarDiretor(id, { nome }) {
  return request(`/api/cadastros/diretores/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome }),
  });
}

export function removerDiretor(id) {
  return request(`/api/cadastros/diretores/${id}`, { method: 'DELETE' });
}

export function fetchRedes() {
  return request('/api/cadastros/redes');
}

export function criarRede({ diretorId, nome, emoji }) {
  return request('/api/cadastros/redes', {
    method: 'POST',
    body: JSON.stringify({ diretorId, nome, emoji }),
  });
}

export function atualizarRede(id, { nome, emoji, responsavelId, ativo, visivel, diretorId }) {
  return request(`/api/cadastros/redes/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, emoji, responsavelId, ativo, visivel, diretorId }),
  });
}

export function removerRede(id) {
  return request(`/api/cadastros/redes/${id}`, { method: 'DELETE' });
}

export function criarLoja({ redeId, nome }) {
  return request('/api/cadastros/lojas', {
    method: 'POST',
    body: JSON.stringify({ redeId, nome }),
  });
}

export function atualizarLoja(id, { nome, ativo, redeId }) {
  return request(`/api/cadastros/lojas/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ nome, ativo, redeId }),
  });
}

export function fetchResponsaveis() {
  return request('/api/cadastros/responsaveis');
}

export function criarResponsavel({ nome }) {
  return request('/api/cadastros/responsaveis', {
    method: 'POST',
    body: JSON.stringify({ nome }),
  });
}

export function removerResponsavel(id) {
  return request(`/api/cadastros/responsaveis/${id}`, { method: 'DELETE' });
}
