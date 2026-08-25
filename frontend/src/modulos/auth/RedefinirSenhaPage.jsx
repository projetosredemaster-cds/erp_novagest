import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { redefinirSenha } from './authApi.js';

const btn = "flex h-11 w-full items-center justify-center bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 text-sm font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const input = "w-full bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)] px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:border-[var(--teal)]";

const SENHA_HINT = 'Mínimo de 6 caracteres, com pelo menos 1 letra maiúscula, 1 número e 1 caractere especial.';

function LinkInvalidoCard() {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
        Link de recuperação inválido ou expirado.
      </div>
      <Link to="/esqueci-senha" className="text-center text-[12.5px] font-semibold text-[var(--teal)] hover:underline">
        Solicitar novo link
      </Link>
    </div>
  );
}

export default function RedefinirSenhaPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [tokenInvalido, setTokenInvalido] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (novaSenha !== confirmarSenha) {
      setError('As senhas não coincidem.');
      return;
    }

    setSubmitting(true);
    redefinirSenha({ token, novaSenha })
      .then((res) => setSuccessMsg(res?.message || 'Senha redefinida com sucesso.'))
      .catch((err) => {
        if (err.message === 'Link de recuperação inválido ou expirado.') {
          setTokenInvalido(true);
        } else {
          setError(err.message || 'Erro interno ao redefinir senha.');
        }
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 sm:p-6 text-[var(--text)]">
      <div className="w-full max-w-[380px] rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-5 py-7 sm:px-7 sm:py-8">
        <div className="mb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">ERP</div>
          <h1 className="font-display mt-0.5 text-2xl sm:text-[28px] font-extrabold leading-none">Redefinir senha</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">Escolha uma nova senha para sua conta.</p>
        </div>

        {!token || tokenInvalido ? (
          <LinkInvalidoCard />
        ) : successMsg ? (
          <div className="flex flex-col gap-3.5">
            <div className="rounded-lg border border-[var(--teal)] bg-[var(--teal)]/10 px-3.5 py-2.5 text-[13px] text-[var(--teal)]">
              {successMsg}
            </div>
            <Link to="/login" className="text-center text-[12.5px] font-semibold text-[var(--teal)] hover:underline">
              Ir para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3.5">
            <div>
              <label htmlFor="redefinir-nova-senha" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--muted)]">
                Nova senha
              </label>
              <input
                id="redefinir-nova-senha"
                type="password"
                autoComplete="new-password"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
                className={input}
              />
              <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">{SENHA_HINT}</p>
            </div>

            <div>
              <label htmlFor="redefinir-confirmar-senha" className="mb-1.5 block text-[12.5px] font-semibold text-[var(--muted)]">
                Confirmar nova senha
              </label>
              <input
                id="redefinir-confirmar-senha"
                type="password"
                autoComplete="new-password"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                className={input}
              />
            </div>

            {error ? (
              <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
                {error}
              </div>
            ) : null}

            <button type="submit" className={btn} disabled={submitting}>
              {submitting ? 'Redefinindo...' : 'Redefinir senha'}
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
