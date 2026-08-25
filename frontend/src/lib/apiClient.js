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

export async function apiRequest(path, { method, body, token, emitOn401 = true, cache } = {}) {
  const authToken = token !== undefined ? token : getToken();

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
    throw new Error('Não foi possível conectar ao servidor.');
  }

  if (!response.ok) {
    const errorBody = await parseJsonSafely(response);
    if (response.status === 401 && emitOn401) emitUnauthorized();
    throw new Error(errorBody?.error || `Erro ao comunicar com o servidor (${response.status}).`);
  }

  return parseJsonSafely(response);
}
