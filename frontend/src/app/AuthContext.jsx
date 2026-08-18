
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login as loginRequest, getMe } from '../modulos/auth/authApi.js';
import { loadAuth, saveAuth, clearAuth } from './authStorage.js';
import { onUnauthorized } from './authEvents.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const clearSession = useCallback(() => {
    clearAuth();
    setToken(null);
    setUsuario(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = loadAuth();

    const validation = stored
      ? getMe(stored.token)
        .then((me) => {
          if (cancelled) return;
          setToken(stored.token);
          setUsuario(me);
        })
        .catch(() => {
          clearAuth();
        })
      : Promise.resolve();

    validation.finally(() => {
      if (!cancelled) setLoadingAuth(false);
    });

    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    return onUnauthorized(() => {
      clearSession();
      navigate('/login', { replace: true });
    });
  }, [clearSession, navigate]);

  async function login(email, senha) {
    const resposta = await loginRequest({ email, senha });
    saveAuth({ token: resposta.token, usuario: resposta.usuario });
    setToken(resposta.token);
    setUsuario(resposta.usuario);
  }

  function logout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  const value = {
    token,
    usuario,
    isAuthenticated: Boolean(token && usuario),
    isAdmin: Boolean(usuario?.isAdmin),
    loadingAuth,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth precisa ser usado dentro de <AuthProvider>.');
  }
  return ctx;
}
