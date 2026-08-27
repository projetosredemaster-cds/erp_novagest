import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../app/AuthContext.jsx';
import { moduleRegistry } from '../../app/moduleRegistry.js';

const btn = "flex h-11 w-full items-center justify-center bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 text-sm font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnReativacao = "flex h-11 w-full items-center justify-center bg-[var(--pd-accent,var(--teal))] text-white border-none rounded-lg px-3.5 text-sm font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const inputErp = "w-full bg-[var(--pd-surface-alt,var(--panel-alt))] border border-[var(--pd-border,var(--border))] text-[var(--text)] px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:border-[var(--teal)]";
const inputReativacao = "w-full bg-[var(--pd-surface-alt,var(--panel-alt))] border border-[var(--pd-border,var(--border))] text-[var(--text)] px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:border-[var(--pd-accent,var(--teal))]";

const defaultPath = moduleRegistry.find((mod) => !mod.adminOnly)?.path || '/ranking';

function redirectPathForRole(role) {
  return role === 'operador_cobranca' ? '/controle-ligacoes' : defaultPath;
}

export default function LoginPage() {
  const { login, loginReativacao } = useAuth();
  const navigate = useNavigate();
  const [modo, setModo] = useState('erp');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const isReativacao = modo === 'reativacao';

  function alternarModo() {
    setModo(isReativacao ? 'erp' : 'reativacao');
    setError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const autenticar = isReativacao ? loginReativacao : login;
    autenticar(email, senha)
      .then((usuario) => navigate(redirectPathForRole(usuario?.role), { replace: true }))
      .catch((err) => setError(err.message || 'Erro ao entrar.'))
      .finally(() => setSubmitting(false));
  }

  return (
    <div
      className={`flex min-h-screen items-center justify-center p-4 sm:p-6 ${
        isReativacao
          ? 'painel-disparo-light-theme cl-figtree bg-[var(--pd-bg)] text-[var(--pd-text-primary)]'
          : 'bg-[var(--bg)] text-[var(--text)]'
      }`}
    >
      <div className="w-full max-w-[380px] rounded-2xl border border-[var(--pd-border,var(--border))] bg-[var(--pd-card-bg,var(--panel))] px-5 py-7 sm:px-7 sm:py-8">
        <div className="mb-6">
          <div
            className={`text-[11px] font-semibold uppercase tracking-[.14em] ${
              isReativacao ? 'text-[var(--pd-accent,var(--teal))]' : 'text-[var(--teal)]'
            }`}
          >
            {isReativacao ? 'Controle de Ligações' : 'ERP'}
          </div>
          <h1 className="font-display mt-0.5 text-2xl sm:text-[28px] font-extrabold leading-none">
            {isReativacao ? 'NovaGest — Controle de Ligações' : 'Novagest'}
          </h1>
          <p className="mt-2 text-[13px] text-[var(--pd-text-secondary,var(--muted))]">Entre com seu e-mail e senha para continuar.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--pd-text-secondary,var(--muted))]">
              E-mail
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={isReativacao ? inputReativacao : inputErp}
            />
          </div>

          <div>
            <label htmlFor="login-senha" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--pd-text-secondary,var(--muted))]">
              Senha
            </label>
            <input
              id="login-senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={isReativacao ? inputReativacao : inputErp}
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {error}
            </div>
          ) : null}

          <button type="submit" className={isReativacao ? btnReativacao : btn} disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>

          {isReativacao ? (
            <>
              <Link
                to="/esqueci-senha"
                className="text-center text-[12.5px] font-semibold text-[var(--pd-accent,var(--teal))] hover:underline"
              >
                Esqueci minha senha
              </Link>
              <button
                type="button"
                onClick={alternarModo}
                className="text-center text-[12.5px] font-semibold text-[var(--pd-text-secondary,var(--muted))] hover:underline"
              >
                Voltar ao login do ERP
              </button>
            </>
          ) : (
            <>
              <Link
                to="/esqueci-senha"
                className="text-center text-[12.5px] font-semibold text-[var(--teal)] hover:underline"
              >
                Esqueci minha senha
              </Link>
              <button
                type="button"
                onClick={alternarModo}
                className="text-center text-[12.5px] font-semibold text-[var(--pd-text-secondary,var(--muted))] hover:underline"
              >
                Controle de Ligações
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
