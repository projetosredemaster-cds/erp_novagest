import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
export default function RequireAdmin() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <Navigate to="/ranking" replace />;
  }

  return <Outlet />;
}
