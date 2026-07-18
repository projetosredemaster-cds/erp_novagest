// style-system: n/a (módulo de dados, sem JSX)
// Cliente de fetch compartilhado entre os arquivos <modulo>Api.js (ex.
// rankingApi.js, authApi.js). Centraliza a base URL, o header
// `Authorization: Bearer <token>` e o tratamento padrão de erro — incluindo
// o aviso global de sessão expirada/inválida em respostas 401, para que
// qualquer módulo autenticado seja deslogado e redirecionado ao vivo, sem
// precisar reimplementar esse interceptor em cada <modulo>Api.js.

import { getToken } from '../app/authStorage.js';
import { emitUnauthorized } from '../app/authEvents.js';

const BASE_URL = import.meta.env.VITE_API_URL;

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// `token`: passe explicitamente (ex. `null` no login, ou o token corrente
// vindo do AuthContext nas rotas de admin) para não depender do que está
// salvo em localStorage; se omitido, cai no token persistido (uso típico do
// rankingApi.js, que não tem acesso direto ao AuthContext).
// `emitOn401`: desligado nas chamadas cujo 401 tem outro significado que não
// "sessão expirada" (ex. login com credenciais erradas).
export async function apiRequest(path, { method, body, token, emitOn401 = true } = {}) {
  const authToken = token !== undefined ? token : getToken();

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      body,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    });
  } catch {
    // erro de rede (backend fora do ar, DNS, CORS bloqueado, etc.)
    throw new Error('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const errorBody = await parseJsonSafely(response);
    if (response.status === 401 && emitOn401) emitUnauthorized();
    throw new Error(errorBody?.error || `Erro ao comunicar com o servidor (${response.status}).`);
  }

  return parseJsonSafely(response);
}
