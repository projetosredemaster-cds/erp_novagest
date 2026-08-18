import { NavLink, Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { moduleRegistry } from './moduleRegistry.js';
import { useAuth } from './AuthContext.jsx';

export default function Sidebar() {
  const { isAdmin, logout } = useAuth();
  const [configOpen, setConfigOpen] = useState(false);
  const configMenuRef = useRef(null);
  const visibleModules = moduleRegistry.filter((mod) => !mod.adminOnly);
  const configModules = moduleRegistry.filter((mod) => mod.adminOnly);

  // fecha o menu "Configurações" ao clicar fora dele.
  useEffect(() => {
    if (!configOpen) return;
    function handleClickOutside(e) {
      if (configMenuRef.current && !configMenuRef.current.contains(e.target)) {
        setConfigOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [configOpen]);

  const configLinkClass = "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]";

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

      <div className="mt-auto flex flex-col gap-1">
        {}
        {isAdmin && configModules.length ? (
          <div className="relative" ref={configMenuRef}>
            {configOpen ? (
              <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-1 shadow-lg">
                {configModules.map((mod) => (
                  <Link key={mod.id} to={mod.path} onClick={() => setConfigOpen(false)} className={configLinkClass}>
                    {mod.icon ? <span className="text-base leading-none">{mod.icon}</span> : null}
                    {mod.label}
                  </Link>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setConfigOpen((v) => !v)}
              aria-expanded={configOpen}
              aria-haspopup="true"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                configOpen ? 'bg-[var(--panel-alt)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
              }`}
            >
              <span className="text-base leading-none">⚙</span>
              Configurações
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel-alt)] hover:text-[var(--danger)]"
        >
          <span className="text-base leading-none">🚪</span>
          Sair
        </button>
      </div>
    </aside>
  );
}
