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
// `cache`: repassado direto para o `fetch` (ex. `'no-store'`). Opcional e
// `undefined` por padrão — não muda o comportamento de cache de nenhuma
// chamada existente; foi adicionado para o Painel de Disparo do Controle de
// Ligações (dados que mudam a cada poucos segundos, não devem ser servidos
// do cache HTTP do navegador), mas qualquer `<modulo>Api.js` pode usar.
export async function apiRequest(path, { method, body, token, emitOn401 = true, cache } = {}) {
  const authToken = token !== undefined ? token : getToken();

  // Upload multipart (ex.: importação de contatos do Controle de Ligações):
  // quando `body` é um FormData, o próprio `fetch` define o header
  // `Content-Type: multipart/form-data; boundary=...` — um `Content-Type:
  // application/json` fixo por cima corromperia o envio. Todo o resto do
  // projeto continua enviando `application/json` normalmente.
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      body,
      ...(cache ? { cache } : {}),
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
