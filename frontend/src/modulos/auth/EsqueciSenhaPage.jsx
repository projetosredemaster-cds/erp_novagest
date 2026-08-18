// style-system: Tailwind
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { esqueciSenha } from './authApi.js';

const btn = "w-full bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-2.5 text-sm font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const input = "w-full bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:border-[var(--teal)]";

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    esqueciSenha({ email })
      .then((res) => setSuccessMsg(res?.message || 'Se o e-mail informado estiver cadastrado, você receberá um link de recuperação em instantes.'))
      .catch((err) => setError(err.message || 'Erro ao processar solicitação.'))
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="w-full max-w-[380px] rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-7 py-8">
        <div className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">ERP</div>
          <h1 className="font-display mt-0.5 text-[28px] font-extrabold leading-none">Esqueci minha senha</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Informe seu e-mail cadastrado para receber um link de recuperação.
          </p>
        </div>

        {successMsg ? (
          <div className="flex flex-col gap-3.5">
            <div className="rounded-lg border border-[var(--teal)] bg-[var(--teal)]/10 px-3.5 py-2.5 text-[13px] text-[var(--teal)]">
              {successMsg}
            </div>
            <Link to="/login" className="text-center text-[12.5px] font-semibold text-[var(--teal)] hover:underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
            <div>
              <label htmlFor="esqueci-email" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--muted)]">
                E-mail
              </label>
              <input
                id="esqueci-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
                {error}
              </div>
            ) : null}

            <button type="submit" className={btn} disabled={submitting}>
              {submitting ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>

            <Link to="/login" className="text-center text-[12.5px] font-semibold text-[var(--teal)] hover:underline">
              Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
