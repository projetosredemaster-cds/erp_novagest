// style-system: n/a (módulo de dados, sem JSX)
// Persistência da sessão autenticada em localStorage. Único lugar do
// frontend que conhece a chave/formato usados — AuthContext e o cliente de
// API compartilhado (src/lib/apiClient.js) sempre passam por aqui, nunca
// leem/escrevem localStorage diretamente.

const STORAGE_KEY = 'novagest_auth';

export function loadAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.usuario) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuth({ token, usuario }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, usuario }));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getToken() {
  return loadAuth()?.token ?? null;
}
