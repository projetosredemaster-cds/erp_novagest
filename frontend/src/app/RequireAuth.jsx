import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
export default function RequireAuth() {
  const { isAuthenticated, isOperadorCobranca, loadingAuth } = useAuth();

  if (loadingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]">
        Carregando...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isOperadorCobranca) {
    return <Navigate to="/controle-ligacoes" replace />;
  }

  return <Outlet />;
}
