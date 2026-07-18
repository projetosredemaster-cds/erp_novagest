// style-system: Tailwind
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { moduleRegistry } from '../../app/moduleRegistry.js';

const btn = "w-full bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-2.5 text-sm font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const input = "w-full bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:border-[var(--teal)]";

// rota padrão pós-login: primeiro módulo não-restrito do registro central
const defaultPath = moduleRegistry.find((mod) => !mod.adminOnly)?.path || '/ranking';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    login(email, senha)
      .then(() => navigate(defaultPath, { replace: true }))
      .catch((err) => setError(err.message || 'Erro ao entrar.'))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="w-full max-w-[380px] rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-7 py-8">
        <div className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">ERP</div>
          <h1 className="font-display mt-0.5 text-[28px] font-extrabold leading-none">Novagest</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">Entre com seu e-mail e senha para continuar.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--muted)]">
              E-mail
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>

          <div>
            <label htmlFor="login-senha" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--muted)]">
              Senha
            </label>
            <input
              id="login-senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={input}
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </div>
          ) : null}

          <button type="submit" className={btn} disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
