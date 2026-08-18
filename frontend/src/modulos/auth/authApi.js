import { apiRequest } from '../../lib/apiClient.js';

export function login({ email, senha }) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
    token: null,
    emitOn401: false,
  });
}

export function getMe(token) {
  return apiRequest('/api/auth/me', { token, emitOn401: false });
}

export function listarUsuarios(token) {
  return apiRequest('/api/admin/usuarios', { token });
}

export function criarUsuario(token, { email, senha }) {
  return apiRequest('/api/admin/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
    token,
  });
}

export function removerUsuario(token, id) {
  return apiRequest(`/api/admin/usuarios/${id}`, { method: 'DELETE', token });
}
