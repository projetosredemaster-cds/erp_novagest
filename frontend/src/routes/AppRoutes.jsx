import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../app/AppShell.jsx';
import RequireAuth from '../app/RequireAuth.jsx';
import RequireAdmin from '../app/RequireAdmin.jsx';
import LoginPage from '../modulos/auth/LoginPage.jsx';
import { moduleRegistry } from '../app/moduleRegistry.js';

export default function AppRoutes() {
  const firstModulePath = moduleRegistry.find((mod) => !mod.adminOnly)?.path;

  return (
    <Routes>
      {/* rota pública: sem <AppShell/>/Sidebar, fora da proteção de <RequireAuth/> */}
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          {firstModulePath ? (
            <Route index element={<Navigate to={firstModulePath} replace />} />
          ) : null}
          {moduleRegistry.map((mod) => {
            const ModuleComponent = mod.element;
            const route = (
              <Route
                key={mod.id}
                path={mod.path.replace(/^\//, '')}
                element={<ModuleComponent />}
              />
            );

            // itens adminOnly ganham uma camada extra de proteção; se um
            // usuário comum tentar acessar a URL direto, é redirecionado.
            if (mod.adminOnly) {
              return (
                <Route key={`${mod.id}-guard`} element={<RequireAdmin />}>
                  {route}
                </Route>
              );
            }

            return route;
          })}
        </Route>
      </Route>
    </Routes>
  );
}
