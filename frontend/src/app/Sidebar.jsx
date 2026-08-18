import { NavLink, Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { moduleRegistry } from './moduleRegistry.js';
import { useAuth } from './AuthContext.jsx';

export default function Sidebar() {
  const { isAdmin, logout } = useAuth();
  const [configOpen, setConfigOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const configMenuRef = useRef(null);
  const visibleModules = moduleRegistry.filter((mod) => !mod.adminOnly);
  const configModules = moduleRegistry.filter((mod) => mod.adminOnly);

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

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const configLinkClass = "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)]";

  return (
    <>
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
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">ERP</div>
          <div className="font-display mt-0.5 text-xl font-extrabold leading-none text-[var(--text)]">Novagest</div>
        </div>

        <nav className="flex flex-col gap-1">
          {visibleModules.map((mod) => (
            <NavLink
              key={mod.id}
              to={mod.path}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
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
          {isAdmin && configModules.length ? (
            <div className="relative" ref={configMenuRef}>
              {configOpen ? (
                <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-1 shadow-lg">
                  {configModules.map((mod) => (
                    <Link
                      key={mod.id}
                      to={mod.path}
                      onClick={() => {
                        setConfigOpen(false);
                        setMobileOpen(false);
                      }}
                      className={configLinkClass}
                    >
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
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
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
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel-alt)] hover:text-[var(--danger)]"
          >
            <span className="text-base leading-none">🚪</span>
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
