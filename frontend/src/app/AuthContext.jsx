// style-system: n/a (contexto/estado, sem JSX de UI)
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
  // true até a validação do token salvo (GET /auth/me) terminar — evita
  // "piscar" a tela de login antes de saber se já existe uma sessão válida.
  const [loadingAuth, setLoadingAuth] = useState(true);

  const clearSession = useCallback(() => {
    clearAuth();
    setToken(null);
    setUsuario(null);
  }, []);

  // valida o token salvo (se houver) uma única vez, ao montar a app
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
          // token inválido/expirado (401) ou erro de rede: trata como deslogado
          clearAuth();
        })
      : Promise.resolve();

    validation.finally(() => {
      if (!cancelled) setLoadingAuth(false);
    });

    return () => { cancelled = true; };
  }, []);

  // qualquer chamada de API (de qualquer módulo) que receba 401 dispara este
  // evento global — encerra a sessão local e manda o usuário pro login,
  // mesmo que ele já estivesse navegando dentro da área autenticada.
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

// eslint-disable-next-line react-refresh/only-export-components -- hook precisa viver junto do Provider/Context
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth precisa ser usado dentro de <AuthProvider>.');
  }
  return ctx;
}
