// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

export default function UserFooterMenu({ colapsada = false }) {
  const { usuario, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const nomeExibicao = usuario?.email ? usuario.email.split('@')[0] : 'Usuário';
  const inicial = nomeExibicao.charAt(0).toUpperCase() || '?';

  useEffect(() => {
    if (!open) return undefined;

    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function handleSair() {
    setOpen(false);
    logout();
  }

  return (
    <div className="relative" ref={menuRef}>
      {open ? (
        <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-[var(--pd-border,var(--border))] bg-[var(--pd-surface-alt,var(--panel-alt))] p-1 shadow-lg">
          <div className={colapsada ? 'group relative' : undefined}>
            <button
              type="button"
              onClick={handleSair}
              className={`flex items-center gap-2.5 rounded-lg text-sm font-semibold text-[var(--pd-text-secondary,var(--muted))] transition-colors hover:bg-[var(--pd-card-bg,var(--panel))] hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-border,var(--border))] ${
                colapsada ? 'h-10 w-10 justify-center px-0' : 'w-full px-3 py-2.5'
              }`}
            >
              <span className="text-base leading-none" aria-hidden="true">🚪</span>
              {!colapsada ? 'Sair' : null}
            </button>
            {colapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--pd-text-primary,var(--text))] px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 z-50">
                Sair
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-semibold text-[var(--pd-text-primary,var(--text))] transition-colors hover:bg-[var(--pd-surface-alt,var(--panel-alt))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pd-border,var(--border))] ${colapsada ? 'justify-center' : ''}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--pd-border,var(--border))] bg-[var(--pd-surface-alt,var(--panel-alt))] text-sm font-bold uppercase leading-none text-[var(--pd-text-primary,var(--text))]">
          {inicial}
        </span>
        {!colapsada ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{nomeExibicao}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal leading-none text-[var(--pd-text-secondary,var(--muted))]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
              Disponível
            </span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
