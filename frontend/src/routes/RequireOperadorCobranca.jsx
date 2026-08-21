import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../app/AuthContext.jsx';

export default function RequireOperadorCobranca() {
  const { isAuthenticated, isOperadorCobranca, loadingAuth } = useAuth();

  if (loadingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]">
        Carregando...
      </div>
    );
  }

  if (!isAuthenticated || !isOperadorCobranca) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
