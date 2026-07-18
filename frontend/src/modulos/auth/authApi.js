// style-system: n/a (módulo de dados, sem JSX)
// Camada de acesso às rotas de autenticação e administração de usuários
// (ver CONTRATO-AUTH-API.md na raiz do repo). Isola as chamadas fetch,
// seguindo o mesmo padrão de frontend/src/modulos/ranking/rankingApi.js.

import { apiRequest } from '../../lib/apiClient.js';

// Rota pública: nunca envia um token salvo (mesmo que exista um antigo
// inválido em localStorage) e um 401 aqui significa "credenciais erradas",
// não "sessão expirada" — não deve disparar o logout global.
export function login({ email, senha }) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
    token: null,
    emitOn401: false,
  });
}

// Usado pelo AuthContext para validar um token salvo ao carregar a app; um
// 401 aqui já é tratado explicitamente por quem chama (limpar sessão local),
// então também não precisa do aviso global de "sessão expirada".
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
