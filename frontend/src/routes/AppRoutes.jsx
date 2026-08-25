import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../app/AppShell.jsx';
import RequireAuth from '../app/RequireAuth.jsx';
import RequireAdmin from '../app/RequireAdmin.jsx';
import ControleLigacoesShell from '../app/ControleLigacoesShell.jsx';
import RequireOperadorCobranca from './RequireOperadorCobranca.jsx';
import LoginPage from '../modulos/auth/LoginPage.jsx';
import EsqueciSenhaPage from '../modulos/auth/EsqueciSenhaPage.jsx';
import RedefinirSenhaPage from '../modulos/auth/RedefinirSenhaPage.jsx';
import ControleLigacoesHomePage from '../modulos/controle-ligacoes/ControleLigacoesHomePage.jsx';
import NumerosRemetentesPage from '../modulos/controle-ligacoes/configuracoes/NumerosRemetentesPage.jsx';
import ImportacaoPage from '../modulos/controle-ligacoes/importacao/ImportacaoPage.jsx';
import PainelDisparoPage from '../modulos/controle-ligacoes/painel-disparo/PainelDisparoPage.jsx';
import ConversasPage from '../modulos/controle-ligacoes/conversas/ConversasPage.jsx';
import UsuariosPage from '../modulos/admin/UsuariosPage.jsx';
import { moduleRegistry } from '../app/moduleRegistry.js';

export default function AppRoutes() {
  const firstModulePath = moduleRegistry.find((mod) => !mod.adminOnly)?.path;

  return (
    <Routes>
      {}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/esqueci-senha" element={<EsqueciSenhaPage />} />
      <Route path="/redefinir-senha" element={<RedefinirSenhaPage />} />

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

      <Route element={<RequireOperadorCobranca />}>
        <Route path="controle-ligacoes" element={<ControleLigacoesShell />}>
          <Route index element={<ControleLigacoesHomePage />} />
          <Route path="configuracoes/numeros-remetentes" element={<NumerosRemetentesPage />} />
          <Route path="importacao" element={<ImportacaoPage />} />
          <Route path="conversas" element={<ConversasPage />} />
          <Route path="painel-disparo" element={<PainelDisparoPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="usuarios" element={<UsuariosPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
