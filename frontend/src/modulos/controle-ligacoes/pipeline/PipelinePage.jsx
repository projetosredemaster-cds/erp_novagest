// style-system: Tailwind
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchPipeline, fetchHistoricoStatus, atualizarStatusConversa } from './pipelineApi.js';
import { fetchNumerosRemetentes } from '../configuracoes/controleLigacoesConfigApi.js';
import DateRangeFilter from '../components/DateRangeFilter.jsx';

const STATUS_LABELS = {
  atendeu: 'Atendeu',
  agendou: 'Agendou',
  nao_atendeu: 'Não atendeu',
  venda: 'Venda',
  perdido: 'Perdido',
};

const STATUS_CORES = {
  atendeu: { text: 'text-[var(--teal)]', bg: 'bg-[var(--teal)]/10', border: 'border-[var(--teal)]/40' },
  agendou: { text: 'text-[var(--violet)]', bg: 'bg-[var(--violet)]/10', border: 'border-[var(--violet)]/40' },
  nao_atendeu: { text: 'text-[var(--warning)]', bg: 'bg-[var(--warning-bg)]', border: 'border-[var(--warning)]/40' },
  venda: { text: 'text-[var(--success)]', bg: 'bg-[var(--success-bg)]', border: 'border-[var(--success)]/40' },
  perdido: { text: 'text-[var(--danger)]', bg: 'bg-[var(--danger-bg)]', border: 'border-[var(--danger)]/40' },
};

function corStatus(status) {
  return STATUS_CORES[status] ?? { text: 'text-[var(--pd-text-secondary)]', bg: 'bg-transparent', border: 'border-[var(--pd-border)]' };
}

function labelStatus(status) {
  return STATUS_LABELS[status] ?? 'Sem status';
}

// Cores em hex (mesmos valores de STATUS_HEX em InicioPage.jsx), usadas para os
// containers/chips inline (borderColor/background/color) do cabeçalho de coluna e dos cards.
const STATUS_HEX = {
  atendeu: '#4fd1c5',
  agendou: '#a78bfa',
  nao_atendeu: '#e3b341',
  venda: '#34d399',
  perdido: '#e0645a',
};

const STATUS_ICONES = {
  atendeu: '💬',
  agendou: '📅',
  nao_atendeu: '🚫',
  venda: '✅',
  perdido: '❌',
};

function IconClock({ size = 12, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconPhone({ size = 12, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconUser({ size = 12, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// Colunas fixas do kanban, na ordem exigida.
const COLUNAS = [
  { status: 'atendeu', titulo: STATUS_LABELS.atendeu },
  { status: 'agendou', titulo: STATUS_LABELS.agendou },
  { status: 'nao_atendeu', titulo: STATUS_LABELS.nao_atendeu },
  { status: 'venda', titulo: STATUS_LABELS.venda },
  { status: 'perdido', titulo: STATUS_LABELS.perdido },
];

function formatRelativo(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const diffMs = Date.now() - data.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

function formatDataHora(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function iniciaisNome(nome) {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
}

const card = "bg-[var(--pd-card-bg)] rounded-xl shadow-sm p-3 flex flex-col gap-2 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5";
const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50";

function PipelineCard({ item, salvando, onAlterarStatus, onAbrirDetalhe }) {
  const corHex = STATUS_HEX[item.status];

  return (
    <div className={card} onClick={() => onAbrirDetalhe(item)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[var(--pd-text-primary)]">{item.nome}</span>
        <span className="flex items-center gap-1 text-[11px] text-[var(--pd-text-secondary)]">
          <IconClock size={12} />{formatRelativo(item.atualizado_em)}
        </span>
      </div>

      <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-[var(--pd-border)] px-2 py-1 text-xs text-[var(--pd-text-secondary)]">
        <IconPhone size={12} /> {item.telefone}
      </div>

      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[var(--pd-surface-alt)] px-2 py-1 text-xs text-[var(--pd-text-secondary)]">
        <IconUser size={12} /> {item.apelido || '—'}
      </div>

      <select
        className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-[var(--pd-accent)]"
        style={{ borderColor: `${corHex}66`, background: `${corHex}1A`, color: corHex }}
        aria-label={`Status da conversa com ${item.nome}`}
        value={item.status}
        disabled={salvando}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onAlterarStatus(item, e.target.value)}
      >
        {COLUNAS.map((coluna) => (
          <option key={coluna.status} value={coluna.status} disabled={coluna.status === 'atendeu'}>{coluna.titulo}</option>
        ))}
      </select>
    </div>
  );
}

function PipelineCardModal({ item, token, onFechar }) {
  const [historico, setHistorico] = useState(null);
  const [historicoLoading, setHistoricoLoading] = useState(true);
  const [historicoError, setHistoricoError] = useState(null);

  useEffect(() => {
    let ativo = true;

    fetchHistoricoStatus(token, item.contato_id, item.numero_remetente_id)
      .then((lista) => {
        if (!ativo) return;
        setHistorico(lista || []);
      })
      .catch((err) => {
        if (!ativo) return;
        setHistoricoError(err.message || 'Erro ao carregar histórico de status.');
      })
      .finally(() => {
        if (!ativo) return;
        setHistoricoLoading(false);
      });

    return () => {
      ativo = false;
    };
  }, [token, item.contato_id, item.numero_remetente_id]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onFechar();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onFechar]);

  const cores = corStatus(item.status);
  const primeiroContato = historico && historico.length > 0 ? historico[historico.length - 1] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pipeline-card-modal-title"
      onClick={onFechar}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pd-border)]/60 bg-[var(--pd-card-bg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--pd-accent)] text-[13px] font-bold text-white">
              {iniciaisNome(item.nome)}
            </div>
            <div className="min-w-0">
              <div id="pipeline-card-modal-title" className="truncate text-[15px] font-bold text-[var(--pd-text-primary)]">
                {item.nome}
              </div>
              <div className="text-[12px] text-[var(--pd-text-secondary)]">{item.telefone}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="shrink-0 rounded-lg px-2 py-1 text-[16px] text-[var(--pd-text-secondary)] hover:bg-[var(--pd-surface-alt)]"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-[.04em] ${cores.border} ${cores.bg} ${cores.text}`}>
            {labelStatus(item.status)}
          </span>
          <span className="rounded-full bg-[var(--pd-surface-alt)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">
            Atendente: {item.apelido || '—'}
          </span>
        </div>

        {historicoLoading ? (
          <div className="px-1 py-4 text-center text-[12.5px] text-[var(--pd-text-secondary)]">Carregando histórico...</div>
        ) : historicoError ? (
          <div className="mb-3 rounded-lg border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--pd-danger)] break-words">
            {historicoError}
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-[var(--pd-border)]/60 bg-[var(--pd-surface-alt)] px-3 py-2.5 text-[12.5px] text-[var(--pd-text-secondary)]">
              {primeiroContato ? (
                <>Primeiro contato: <span className="font-semibold text-[var(--pd-text-primary)]">{formatDataHora(primeiroContato.alterado_em)}</span></>
              ) : (
                'Sem histórico de status registrado.'
              )}
            </div>

            {historico && historico.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {historico.map((entrada, idx) => (
                  <li
                    key={`${entrada.alterado_em}-${idx}`}
                    className="rounded-lg border border-[var(--pd-border)]/60 px-3 py-2 text-[12.5px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--pd-text-primary)]">
                        {labelStatus(entrada.status_anterior)}
                        {' → '}
                        {labelStatus(entrada.status_novo)}
                      </span>
                      <span className="shrink-0 rounded-full bg-[var(--pd-surface-alt)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[.04em] text-[var(--pd-text-secondary)]">
                        {entrada.origem === 'atendente' ? 'Atendente' : 'Sistema'}
                      </span>
                    </div>
                    <div className="mt-1 text-[11.5px] text-[var(--pd-text-secondary)]">{formatDataHora(entrada.alterado_em)}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <div className="mt-4 flex justify-end">
          <button type="button" className={btnGhost} onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { token } = useAuth();
  const [itens, setItens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [salvandoId, setSalvandoId] = useState(null);
  const [cardSelecionado, setCardSelecionado] = useState(null);

  const [buscaInput, setBuscaInput] = useState('');
  const [busca, setBusca] = useState('');
  const [numeroRemetenteId, setNumeroRemetenteId] = useState('');
  const [numerosRemetentes, setNumerosRemetentes] = useState([]);
  const [statusInicio, setStatusInicio] = useState(null);
  const [statusFim, setStatusFim] = useState(null);
  const [disparoInicio, setDisparoInicio] = useState(null);
  const [disparoFim, setDisparoFim] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setBusca(buscaInput), 400);
    return () => clearTimeout(timer);
  }, [buscaInput]);

  useEffect(() => {
    fetchNumerosRemetentes(token)
      .then((lista) => setNumerosRemetentes(lista || []))
      .catch((err) => console.error('Erro ao buscar números remetentes para o filtro do pipeline:', err));
  }, [token]);

  const carregarPipeline = useCallback(() => (
    fetchPipeline(token, { busca, numeroRemetenteId, statusInicio, statusFim, disparoInicio, disparoFim })
      .then((lista) => {
        setItens(lista || []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar o pipeline.'))
      .finally(() => setLoading(false))
  ), [token, busca, numeroRemetenteId, statusInicio, statusFim, disparoInicio, disparoFim]);

  useEffect(() => {
    carregarPipeline();
  }, [carregarPipeline]);

  function aplicarPeriodoStatus(inicio, fim) {
    setStatusInicio(inicio);
    setStatusFim(fim);
  }

  function aplicarPeriodoDisparo(inicio, fim) {
    setDisparoInicio(inicio);
    setDisparoFim(fim);
  }

  function limparFiltros() {
    setBuscaInput('');
    setBusca('');
    setNumeroRemetenteId('');
    setStatusInicio(null);
    setStatusFim(null);
    setDisparoInicio(null);
    setDisparoFim(null);
  }

  function retry() {
    setLoading(true);
    setLoadError(null);
    carregarPipeline();
  }

  function handleAlterarStatus(item, novoStatus) {
    if (novoStatus === item.status) return;

    setSalvandoId(item.contato_id);
    atualizarStatusConversa(token, item.contato_id, item.numero_remetente_id, novoStatus)
      .then(() => carregarPipeline())
      .catch((err) => {
        console.error('Erro ao atualizar status no pipeline:', err);
        setLoadError(err.message || 'Erro ao atualizar status.');
      })
      .finally(() => setSalvandoId(null));
  }

  const itensPorStatus = COLUNAS.reduce((acc, coluna) => {
    acc[coluna.status] = itens.filter((item) => item.status === coluna.status);
    return acc;
  }, {});

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-[22px] border-b border-[var(--pd-border)]/60 pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de Ligações</div>
          <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Pipeline</h1>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={buscaInput}
            onChange={(e) => setBuscaInput(e.target.value)}
            placeholder="Buscar por nome..."
            aria-label="Buscar por nome do contato"
            className="w-full max-w-xs rounded-full border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-4 py-2 text-sm text-[var(--pd-text-primary)] placeholder:text-[var(--pd-text-secondary)] focus:outline-none focus:border-[var(--pd-accent)]"
          />

          <select
            value={numeroRemetenteId}
            onChange={(e) => setNumeroRemetenteId(e.target.value)}
            aria-label="Filtrar por atendente"
            className="rounded-full border border-[var(--pd-border)] bg-[var(--pd-card-bg)] px-4 py-2 text-sm font-semibold text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]"
          >
            <option value="">Geral</option>
            {numerosRemetentes.map((numero) => (
              <option key={numero.id} value={numero.id}>{numero.apelido}</option>
            ))}
          </select>

          <div>
            <span className="mb-1 block text-[11px] font-semibold text-[var(--pd-text-secondary)]">Data da mudança de status</span>
            <DateRangeFilter dataInicio={statusInicio} dataFim={statusFim} onAplicar={aplicarPeriodoStatus} />
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-[var(--pd-text-secondary)]">Data do disparo</span>
            <DateRangeFilter dataInicio={disparoInicio} dataFim={disparoFim} onAplicar={aplicarPeriodoDisparo} />
          </div>

          <button type="button" onClick={limparFiltros} className={btnGhost}>
            Limpar
          </button>
        </div>

        {loading ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
        ) : loadError ? (
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-5 py-4 text-sm text-[var(--pd-danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="break-words">Não foi possível carregar o pipeline: {loadError}</span>
            <button
              type="button"
              onClick={retry}
              className="shrink-0 rounded-lg border border-[var(--pd-danger)] px-3.5 py-2 text-[13px] font-semibold text-[var(--pd-danger)] hover:bg-[var(--pd-danger)]/10"
            >
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-3">
            {COLUNAS.map((coluna) => {
              const corHex = STATUS_HEX[coluna.status];
              const cardsColuna = itensPorStatus[coluna.status] || [];

              return (
                <div
                  key={coluna.status}
                  className="flex w-72 shrink-0 flex-col gap-3 rounded-2xl border border-[var(--pd-border)]/60 bg-[var(--pd-surface-alt)] p-2 min-h-[70vh]"
                >
                  <div className="flex items-center justify-between rounded-xl border px-4 py-2.5" style={{ borderColor: `${corHex}66`, background: `${corHex}1A` }}>
                    <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: corHex }}>
                      {STATUS_ICONES[coluna.status]} {coluna.titulo}
                    </span>
                    <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold" style={{ color: corHex }}>
                      {cardsColuna.length}
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 overflow-y-auto max-h-[70vh]">
                    {cardsColuna.length === 0 ? (
                      <div className="px-1 py-4 text-center text-[12px] text-[var(--pd-text-secondary)]">
                        Nenhum contato.
                      </div>
                    ) : (
                      cardsColuna.map((item) => (
                        <PipelineCard
                          key={`${item.contato_id}-${item.numero_remetente_id}`}
                          item={item}
                          salvando={salvandoId === item.contato_id}
                          onAlterarStatus={handleAlterarStatus}
                          onAbrirDetalhe={setCardSelecionado}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {cardSelecionado ? (
        <PipelineCardModal
          item={cardSelecionado}
          token={token}
          onFechar={() => setCardSelecionado(null)}
        />
      ) : null}
    </div>
  );
}
