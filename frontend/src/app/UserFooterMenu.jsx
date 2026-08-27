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
        <div className="absolute bottom-full left-0 mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-1 shadow-lg">
          <button
            type="button"
            onClick={handleSair}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border)]"
          >
            <span className="text-base leading-none" aria-hidden="true">🚪</span>
            Sair
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--panel-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border)] ${colapsada ? 'justify-center' : ''}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-alt)] text-sm font-bold uppercase leading-none text-[var(--text)]">
          {inicial}
        </span>
        {!colapsada ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{nomeExibicao}</span>
            <span className="flex items-center gap-1.5 text-xs font-normal leading-none text-[var(--muted)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
              Disponível
            </span>
          </span>
        ) : null}
      </button>
    </div>
  );
}
