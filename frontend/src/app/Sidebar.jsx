import { NavLink } from 'react-router-dom';
import { moduleRegistry } from './moduleRegistry.js';
import { useAuth } from './AuthContext.jsx';

export default function Sidebar() {
  const { isAdmin, logout } = useAuth();
  // itens adminOnly nunca chegam a ser renderizados para usuário comum —
  // não é só um `hidden` de CSS, o link simplesmente não existe no DOM.
  const visibleModules = moduleRegistry.filter((mod) => !mod.adminOnly || isAdmin);

  return (
    <aside className="fixed left-0 top-0 z-10 flex h-screen w-56 flex-col border-r border-[var(--border)] bg-[var(--panel)] px-3 py-5">
      <div className="mb-6 px-2">
        <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">ERP</div>
        <div className="font-display mt-0.5 text-xl font-extrabold leading-none text-[var(--text)]">Novagest</div>
      </div>

      <nav className="flex flex-col gap-1">
        {visibleModules.map((mod) => (
          <NavLink
            key={mod.id}
            to={mod.path}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--teal)] text-[#0b1010]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
              }`
            }
          >
            {mod.icon ? <span className="text-base leading-none">{mod.icon}</span> : null}
            {mod.label}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={logout}
        className="mt-auto flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel-alt)] hover:text-[var(--danger)]"
      >
        <span className="text-base leading-none">🚪</span>
        Sair
      </button>
    </aside>
  );
}