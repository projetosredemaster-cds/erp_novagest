// style-system: Tailwind
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Usado apenas dentro da área já protegida por <RequireAuth/>, então aqui só
// precisamos checar o papel do usuário — se não for admin, manda de volta
// para a rota padrão do sistema em vez de renderizar a tela de admin.
export default function RequireAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <Navigate to="/ranking" replace />;
  }

  return <Outlet />;
}
