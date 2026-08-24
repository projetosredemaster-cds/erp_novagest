// style-system: Tailwind
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

const navItemClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-[var(--violet)] text-[#0b1010]'
      : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
  }`;

export default function ControleLigacoesShell() {
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={mobileOpen}
        className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xl text-[var(--text)] shadow-lg lg:hidden"
      >
        ☰
      </button>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--panel)] px-3 py-5 transition-transform duration-200 lg:w-56 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
          className="mb-4 flex h-11 w-11 items-center justify-center self-end rounded-lg text-xl text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)] lg:hidden"
        >
          ✕
        </button>

        <div className="mb-6 px-2">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">NovaGest</div>
          <div className="font-display mt-0.5 text-xl font-extrabold leading-none text-[var(--text)]">Controle de Ligações</div>
        </div>

        <nav className="flex flex-col gap-1">
          <NavLink to="/controle-ligacoes" end onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">🏠</span>
            Início
          </NavLink>
          <NavLink to="/controle-ligacoes/importacao" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">📥</span>
            Importação
          </NavLink>
          <NavLink to="/controle-ligacoes/painel-disparo" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">🚀</span>
            Painel de Disparo
          </NavLink>
        </nav>

        <div className="mt-auto flex flex-col gap-1">
          <NavLink to="/controle-ligacoes/configuracoes/numeros-remetentes" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">⚙️</span>
            Configurações
          </NavLink>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel-alt)] hover:text-[var(--danger)]"
          >
            <span className="text-base leading-none">🚪</span>
            Sair
          </button>
        </div>
      </aside>

      <main className="min-h-screen lg:ml-56">
        <Outlet />
      </main>
    </div>
  );
}
