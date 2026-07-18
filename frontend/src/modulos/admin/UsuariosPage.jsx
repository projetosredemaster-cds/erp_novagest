// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../app/AuthContext.jsx';
import { listarUsuarios, criarUsuario, removerUsuario } from '../auth/authApi.js';

const btn = "bg-[var(--teal)] text-[#0b1010] border-none rounded-lg px-3.5 py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnDanger = "bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3 py-1.5 text-[12.5px] font-bold cursor-pointer hover:brightness-110";
const inputCls = "min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--teal)]";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-5 pt-5 pb-[22px]";

function formatData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export default function UsuariosPage() {
  const { token } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [novoEmail, setNovoEmail] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [formError, setFormError] = useState(null);
  const [creating, setCreating] = useState(false);

  // type 'success' some rápido; type 'error' fica visível mais tempo (mesmo
  // espírito do flash() de RankingPage.jsx)
  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }

  // sem setState síncrono no corpo (só dentro dos callbacks da promise) para
  // poder ser chamada diretamente pelo efeito de carga inicial.
  function runLoadUsuarios() {
    listarUsuarios(token)
      .then((lista) => setUsuarios(lista || []))
      .catch((err) => setLoadError(err.message || 'Erro ao carregar usuários.'))
      .finally(() => setLoading(false));
  }

  // handler do botão "Tentar novamente" (evento de UI, não roda dentro de um efeito)
  function loadUsuarios() {
    setLoading(true);
    setLoadError(null);
    runLoadUsuarios();
  }

  useEffect(() => {
    // estados iniciais (loading=true, loadError=null) já cobrem a primeira carga
    runLoadUsuarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCreate(e) {
    e.preventDefault();
    setFormError(null);

    if (!novoEmail.trim()) {
      setFormError('E-mail é obrigatório.');
      return;
    }
    if (!novaSenha) {
      setFormError('Senha é obrigatória.');
      return;
    }

    setCreating(true);
    criarUsuario(token, { email: novoEmail.trim(), senha: novaSenha })
      .then((usuarioCriado) => {
        setUsuarios((prev) => [...prev, usuarioCriado].sort((a, b) => a.email.localeCompare(b.email)));
        setNovoEmail('');
        setNovaSenha('');
        flash('Usuário criado.');
      })
      .catch((err) => setFormError(err.message || 'Erro ao criar usuário.'))
      .finally(() => setCreating(false));
  }

  function handleRemove(usuario) {
    if (!confirm(`Remover o usuário "${usuario.email}"?`)) return;
    removerUsuario(token, usuario.id)
      .then(() => {
        setUsuarios((prev) => prev.filter((u) => u.id !== usuario.id));
        flash('Usuário removido.');
      })
      .catch((err) => flash(err.message || 'Erro ao remover usuário.', 'error'));
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6 font-['Inter',sans-serif] text-[var(--text)] antialiased">
      <div className="mx-auto max-w-[820px]">
        <div className="mb-[22px] border-b border-[var(--border)] pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--teal)]">Administração</div>
          <h1 className="font-display mt-0.5 text-[34px] font-extrabold leading-none">Usuários</h1>
        </div>

        <div className={`${card} mb-[18px]`}>
          <h2 className="font-display mb-3.5 text-[19px] font-bold">Novo usuário</h2>
          <form onSubmit={handleCreate} noValidate className="flex flex-wrap items-start gap-2">
            <input
              type="email"
              placeholder="E-mail"
              value={novoEmail}
              onChange={(e) => setNovoEmail(e.target.value)}
              className={inputCls}
            />
            <input
              type="password"
              placeholder="Senha"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className={inputCls}
            />
            <button type="submit" className={btn} disabled={creating}>
              {creating ? 'Criando...' : 'Adicionar usuário'}
            </button>
          </form>
          {formError ? (
            <div className="mt-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)]">
              {formError}
            </div>
          ) : null}
          <p className="mt-3 text-[12px] text-[var(--muted)]">Novos usuários são sempre criados como usuários comuns.</p>
        </div>

        <div className={card}>
          <h2 className="font-display mb-3.5 text-[19px] font-bold">Usuários cadastrados</h2>
          {loading ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Carregando...</div>
          ) : loadError ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)]">
              <span>Não foi possível carregar os usuários: {loadError}</span>
              <button className={btn} onClick={loadUsuarios}>Tentar novamente</button>
            </div>
          ) : usuarios.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--muted)]">Nenhum usuário cadastrado.</div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[.08em] text-[var(--muted)]">
                  <th className="pb-2 font-semibold">E-mail</th>
                  <th className="pb-2 font-semibold">Perfil</th>
                  <th className="pb-2 font-semibold">Criado em</th>
                  <th className="pb-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--border)]">
                    <td className="py-2.5">{u.email}</td>
                    <td className="py-2.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
                          u.isAdmin ? 'bg-[var(--teal)]/15 text-[var(--teal)]' : 'bg-[var(--panel-alt)] text-[var(--muted)]'
                        }`}
                      >
                        {u.isAdmin ? 'Admin' : 'Usuário comum'}
                      </span>
                    </td>
                    <td className="py-2.5 text-[var(--muted)]">{formatData(u.criado_em)}</td>
                    <td className="py-2.5 text-right">
                      <button className={btnDanger} onClick={() => handleRemove(u)}>Remover</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div
        className={`fixed bottom-5 right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--teal)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
