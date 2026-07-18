// style-system: n/a (módulo de dados, sem JSX)
// Pequeno pubsub para o evento "sessão expirada/token inválido" (401),
// detectado dentro do cliente de API (fora da árvore de componentes) mas
// tratado pelo AuthContext (que tem acesso a useNavigate para redirecionar
// para /login). Evita import circular entre lib/apiClient.js e AuthContext.

const listeners = new Set();

export function onUnauthorized(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitUnauthorized() {
  listeners.forEach((callback) => callback());
}
