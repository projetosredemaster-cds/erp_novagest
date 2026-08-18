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
