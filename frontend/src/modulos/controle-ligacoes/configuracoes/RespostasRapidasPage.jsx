// style-system: Tailwind
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../app/useAuth.js';
import {
  fetchRespostasRapidas, criarRespostaRapida, atualizarRespostaRapida, removerRespostaRapida,
} from './controleLigacoesConfigApi.js';

const btn = "bg-[var(--pd-accent)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-card-bg)] disabled:cursor-not-allowed disabled:opacity-50";
const btnDanger = "bg-[var(--danger-bg)] text-[var(--danger)] border-none rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[12.5px] font-bold cursor-pointer hover:brightness-110";
const inputCls = "w-full rounded-lg border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-3 py-3 sm:py-2 text-sm text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]";
const card = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5";

function AtivoBadge({ ativo }) {
  return ativo ? (
    <span className="w-fit rounded-full bg-[var(--pd-accent)]/15 px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--pd-accent-strong)]">Ativa</span>
  ) : (
    <span className="w-fit rounded-full bg-[var(--pd-card-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">Inativa</span>
  );
}

export default function RespostasRapidasPage() {
  const { token } = useAuth();

  const [respostas, setRespostas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }

  function runLoadRespostas() {
    fetchRespostasRapidas(token)
      .then((lista) => setRespostas(lista || []))
      .catch((err) => setLoadError(err.message || 'Erro ao carregar respostas rápidas.'))
      .finally(() => setLoading(false));
  }

  function loadRespostas() {
    setLoading(true);
    setLoadError(null);
    runLoadRespostas();
  }

  useEffect(() => {
    runLoadRespostas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [editingResposta, setEditingResposta] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [ordem, setOrdem] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  function openCreateForm() {
    setEditingResposta(null);
    setTitulo('');
    setCorpo('');
    setOrdem('');
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(resposta) {
    setEditingResposta(resposta);
    setTitulo(resposta.titulo);
    setCorpo(resposta.corpo);
    setOrdem(resposta.ordem === null || resposta.ordem === undefined ? '' : String(resposta.ordem));
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
  }

  function handleSubmitForm(e) {
    e.preventDefault();
    setFormError(null);

    if (!titulo.trim()) {
      setFormError('Campo "título" é obrigatório.');
      return;
    }
    if (!corpo.trim()) {
      setFormError('Campo "corpo" é obrigatório.');
      return;
    }

    const payload = { titulo: titulo.trim(), corpo: corpo.trim() };
    if (ordem.trim() !== '') payload.ordem = Number(ordem);

    setSaving(true);
    const promise = editingResposta
      ? atualizarRespostaRapida(token, editingResposta.id, payload)
      : criarRespostaRapida(token, payload);

    promise
      .then((respostaSalva) => {
        setRespostas((prev) => (
          editingResposta
            ? prev.map((r) => (r.id === respostaSalva.id ? respostaSalva : r))
            : [...prev, respostaSalva]
        ));
        flash(editingResposta ? 'Resposta rápida atualizada.' : 'Resposta rápida criada.');
        setFormOpen(false);
      })
      .catch((err) => setFormError(err.message || 'Erro ao salvar resposta rápida.'))
      .finally(() => setSaving(false));
  }

  function handleToggleAtivo(resposta) {
    atualizarRespostaRapida(token, resposta.id, { ativo: !resposta.ativo })
      .then((respostaAtualizada) => {
        setRespostas((prev) => prev.map((r) => (r.id === respostaAtualizada.id ? respostaAtualizada : r)));
        flash(respostaAtualizada.ativo ? 'Resposta rápida reativada.' : 'Resposta rápida ocultada.');
      })
      .catch((err) => flash(err.message || 'Erro ao atualizar status da resposta rápida.', 'error'));
  }

  function handleDelete(resposta) {
    if (!confirm(`Excluir definitivamente a resposta rápida "${resposta.titulo}"? Essa ação não pode ser desfeita.`)) return;
    removerRespostaRapida(token, resposta.id)
      .then(() => {
        setRespostas((prev) => prev.filter((r) => r.id !== resposta.id));
        flash('Resposta rápida excluída.');
      })
      .catch((err) => flash(err.message || 'Erro ao excluir resposta rápida.', 'error'));
  }

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-[22px] flex flex-col gap-3 border-b border-[var(--pd-border)] pb-[18px] sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de ligações - Configurações</div>
            <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Respostas Rápidas</h1>
            <p className="mt-1 text-[12.5px] text-[var(--pd-text-secondary)]">
              Textos prontos para inserir rapidamente no campo de mensagem, na tela de Conversas.
            </p>
          </div>
          <button type="button" className={`${btn} w-full sm:w-auto`} onClick={openCreateForm}>
            + Nova resposta rápida
          </button>
        </div>

        {}
        <p className="mb-3 text-[11.5px] text-[var(--pd-text-secondary)]">
          Nota: esta lista mostra apenas as respostas rápidas ativas — o endpoint de listagem
          (<code>GET /respostas-rapidas</code>) só devolve itens com <code>ativo=true</code>. Uma
          resposta desativada aqui continua visível (você pode reativá-la) até a página ser
          recarregada; depois disso ela só reaparece se for reativada diretamente no banco ou se
          o endpoint ganhar suporte a listar inativas também.
        </p>

        <div className={card}>
          {loading ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
          ) : loadError ? (
            <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <span className="break-words">Não foi possível carregar as respostas rápidas: {loadError}</span>
              <button className={`${btn} w-full sm:w-auto`} onClick={loadRespostas}>Tentar novamente</button>
            </div>
          ) : respostas.length === 0 ? (
            <div className="px-1 py-6 text-center text-sm text-[var(--pd-text-secondary)]">Nenhuma resposta rápida cadastrada.</div>
          ) : (
            <ul className="flex flex-col gap-3">
              {respostas.map((r) => (
                <li key={r.id} className="rounded-xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--pd-text-primary)]">{r.titulo}</span>
                        <AtivoBadge ativo={r.ativo} />
                      </div>
                      {r.ordem !== null && r.ordem !== undefined ? (
                        <div className="text-[11.5px] text-[var(--pd-text-secondary)]">Ordem: {r.ordem}</div>
                      ) : null}
                    </div>
                  </div>
                  <p className="mb-3 line-clamp-2 whitespace-pre-wrap text-[13px] text-[var(--pd-text-secondary)]">{r.corpo}</p>
                  <div className="flex flex-wrap gap-2">
                    <button className={btnGhost} onClick={() => openEditForm(r)}>Editar</button>
                    <button className={btnGhost} onClick={() => handleToggleAtivo(r)}>{r.ativo ? 'Ocultar' : 'Reativar'}</button>
                    <button className={btnDanger} onClick={() => handleDelete(r)}>Excluir</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {formOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resposta-rapida-form-title"
          onClick={closeForm}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pd-border)] bg-[var(--pd-card-bg)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="resposta-rapida-form-title" className="font-display text-[19px] font-bold">
                {editingResposta ? 'Editar resposta rápida' : 'Nova resposta rápida'}
              </h2>
              <button
                type="button"
                aria-label="Fechar"
                onClick={closeForm}
                className="text-xl leading-none text-[var(--pd-text-secondary)] hover:text-[var(--pd-text-primary)]"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} noValidate className="flex flex-col gap-3">
              <div>
                <label htmlFor="resposta-titulo" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">Título</label>
                <input
                  id="resposta-titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex.: Saudação inicial"
                  className={inputCls}
                />
              </div>

              <div>
                <label htmlFor="resposta-corpo" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">Corpo da mensagem</label>
                <textarea
                  id="resposta-corpo"
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  placeholder="Texto que será inserido no campo de mensagem..."
                  rows={5}
                  className={`${inputCls} resize-none`}
                />
              </div>

              <div>
                <label htmlFor="resposta-ordem" className="mb-1 block text-[12.5px] font-semibold text-[var(--pd-text-secondary)]">Ordem (opcional)</label>
                <input
                  id="resposta-ordem"
                  type="number"
                  value={ordem}
                  onChange={(e) => setOrdem(e.target.value)}
                  placeholder="Ex.: 1"
                  className={inputCls}
                />
              </div>

              {formError ? (
                <div className="rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3.5 py-2.5 text-[13px] text-[var(--danger)] break-words">
                  {formError}
                </div>
              ) : null}

              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={closeForm}>Cancelar</button>
                <button type="submit" className={`${btn} w-full sm:w-auto`} disabled={saving}>
                  {saving ? 'Salvando...' : editingResposta ? 'Salvar alterações' : 'Criar resposta rápida'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--pd-accent)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
