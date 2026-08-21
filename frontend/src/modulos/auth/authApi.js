import { apiRequest } from '../../lib/apiClient.js';

export function login({ email, senha }) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
    token: null,
    emitOn401: false,
  });
}

export function loginReativacao({ email, senha }) {
  return apiRequest('/api/auth/reativacao/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
    token: null,
    emitOn401: false,
  });
}

export function getMe(token) {
  return apiRequest('/api/auth/me', { token, emitOn401: false });
}

export function esqueciSenha({ email }) {
  return apiRequest('/api/auth/esqueci-senha', {
    method: 'POST',
    body: JSON.stringify({ email }),
    token: null,
    emitOn401: false,
  });
}

export function redefinirSenha({ token, novaSenha }) {
  return apiRequest('/api/auth/redefinir-senha', {
    method: 'POST',
    body: JSON.stringify({ token, novaSenha }),
    token: null,
    emitOn401: false,
  });
}

export function listarUsuarios(token) {
  return apiRequest('/api/admin/usuarios', { token });
}

export function criarUsuario(token, { email, senha, operadorCobranca }) {
  return apiRequest('/api/admin/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email, senha, operadorCobranca }),
    token,
  });
}

export function removerUsuario(token, id) {
  return apiRequest(`/api/admin/usuarios/${id}`, { method: 'DELETE', token });
}
