// style-system: Tailwind
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Protege toda a área autenticada do app (montada em torno de <AppShell/> em
// AppRoutes.jsx). Enquanto a validação do token salvo ainda está em
// andamento, mostra um estado de carregamento em vez de redirecionar cedo
// demais para /login.
export default function RequireAuth() {
  const { isAuthenticated, loadingAuth } = useAuth();

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

  return <Outlet />;
}
