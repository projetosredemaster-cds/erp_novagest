const listeners = new Set();

export function onUnauthorized(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function emitUnauthorized() {
  listeners.forEach((callback) => callback());
}
