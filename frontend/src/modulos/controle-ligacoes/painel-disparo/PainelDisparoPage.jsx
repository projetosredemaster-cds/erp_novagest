import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchPainelDisparo, fetchContatosDisponiveis, verificarDisparo, criarDisparo } from './painelDisparoApi.js';
import { fetchNumerosRemetentes } from '../configuracoes/controleLigacoesConfigApi.js';

const btn = "bg-[var(--pd-accent)] text-white border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--pd-border)] text-[var(--pd-text-primary)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--pd-surface-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--pd-border)] bg-[var(--pd-surface-alt)] px-3 py-2.5 sm:py-2 text-sm text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]";
const selectCls = "w-full rounded-lg border border-[var(--pd-border)] bg-[var(--pd-surface-alt)] px-2.5 py-2.5 sm:py-2 text-sm text-[var(--pd-text-primary)] focus:outline-none focus:border-[var(--pd-accent)]";
const card = "bg-[var(--pd-card-bg)] border border-[var(--pd-border)]/60 rounded-2xl px-4 pt-5 pb-[22px] sm:px-5 flex flex-col";

const ORDENS = [
  { value: 'nome_asc', label: 'Nome (A-Z)' },
  { value: 'nome_desc', label: 'Nome (Z-A)' },
  { value: 'recentes', label: 'Mais recentes' },
];

const DEBOUNCE_BUSCA_MS = 400;
const MAX_CONTATOS_POR_DISPARO = 10;

const STATUS_CONEXAO_INFO = {
  conectado: { label: 'Conectado', bg: 'bg-[var(--pd-success-bg)]', text: 'text-[var(--pd-success)]' },
  desconectado: { label: 'Desconectado', bg: 'bg-[var(--pd-danger-bg)]', text: 'text-[var(--pd-danger)]' },
  aguardando_conexao: { label: 'Aguardando conexão', bg: 'bg-[var(--pd-warning-bg)]', text: 'text-[var(--pd-warning)]' },
};

function StatusConexaoBadge({ status }) {
  const info = STATUS_CONEXAO_INFO[status] || { label: status, bg: 'bg-[var(--pd-surface-alt)]', text: 'text-[var(--pd-text-secondary)]' };
  return (
    <span className={`w-fit shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${info.bg} ${info.text}`}>
      {info.label}
    </span>
  );
}

function AvisoContatadoBadge() {
  return (
    <span className="w-fit shrink-0 rounded-full border border-[var(--pd-warning)] bg-[var(--pd-warning-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--pd-warning)]">
      Contatado há menos de 3 dias
    </span>
  );
}

function AvisosModal({ avisos, confirmando, erro, onCancelar, onConfirmar }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avisos-modal-title"
      onClick={confirmando ? undefined : onCancelar}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--pd-border)]/60 bg-[var(--pd-card-bg)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="avisos-modal-title" className="pd-font-serif mb-2 text-[18px] font-bold text-[var(--pd-warning)]">
          Aviso antes de disparar
        </h2>
        <p className="mb-3 text-[13px] text-[var(--pd-text-secondary)]">
          Os contatos abaixo já foram contatados nos últimos 3 dias. Deseja prosseguir com o disparo mesmo assim?
        </p>
        <ul className="mb-4 flex flex-col gap-1.5">
          {avisos.map((c) => (
            <li key={c.contatoId} className="rounded-lg border border-[var(--pd-border)]/60 bg-[var(--pd-surface-alt)] px-3 py-2 text-[13px]">
              <span className="font-semibold text-[var(--pd-text-primary)]">{c.nome}</span>
              <span className="ml-2 text-[var(--pd-text-secondary)]">{c.telefone}</span>
            </li>
          ))}
        </ul>
        {erro ? (
          <div className="mb-3 rounded-lg border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--pd-danger)] break-words">
            {erro}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onCancelar} disabled={confirmando}>Cancelar</button>
          <button type="button" className={btn} onClick={onConfirmar} disabled={confirmando}>
            {confirmando ? 'Disparando...' : 'Disparar mesmo assim'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EstadoDisparoCard({ token, resumo, onFlash, numerosDetalhes }) {
  const { estado, totalContatos, numerosAtivos } = resumo;
  const elegibilidadePorNumero = useMemo(() => {
    const mapa = new Map();
    numerosAtivos.forEach((n) => {
      const detalhe = numerosDetalhes?.get(n.id);
      const nomeColaboradora = detalhe?.nomeColaboradora;
      const temNomeColaboradora = typeof nomeColaboradora === 'string' && nomeColaboradora.trim() !== '';
      const conectado = n.statusConexao === 'conectado';
      const elegivel = conectado && temNomeColaboradora;
      mapa.set(n.id, {
        elegivel,
        motivo: elegivel ? null : (!conectado ? 'desconectado' : 'sem colaboradora configurada'),
      });
    });
    return mapa;
  }, [numerosAtivos, numerosDetalhes]);

  const [numeroRemetenteIdManual, setNumeroRemetenteIdManual] = useState(null);
  const numeroPreferido = numerosAtivos.find((n) => elegibilidadePorNumero.get(n.id)?.elegivel) || numerosAtivos[0] || null;
  const numeroRemetenteId = numeroRemetenteIdManual !== null
    ? numeroRemetenteIdManual
    : (numeroPreferido ? String(numeroPreferido.id) : '');

  const estadoId = estado.id;

  const [buscaInput, setBuscaInput] = useState('');
  const [busca, setBusca] = useState('');
  const [ordemState, setOrdemState] = useState('nome_asc');
  const ultimaBuscaAplicadaRef = useRef('');
  const [contatos, setContatos] = useState([]);
  const [loadingContatos, setLoadingContatos] = useState(true);
  const [contatosError, setContatosError] = useState(null);
  const requestIdRef = useRef(0);

  const carregarContatos = useCallback(() => {
    const requestId = ++requestIdRef.current;
    fetchContatosDisponiveis(token, estadoId, { busca, ordem: ordemState })
      .then((lista) => {
        if (requestIdRef.current !== requestId) return;
        setContatos(lista || []);
        setContatosError(null); 
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setContatosError(err.message || 'Erro ao carregar contatos.');
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        setLoadingContatos(false);
      });
  }, [token, estadoId, busca, ordemState]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const valorTrimado = buscaInput.trim();
      if (valorTrimado === ultimaBuscaAplicadaRef.current) return;
      ultimaBuscaAplicadaRef.current = valorTrimado;
      setLoadingContatos(true);
      setContatosError(null);
      setBusca(valorTrimado);
    }, DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(timer);
  }, [buscaInput]);

  function setOrdem(novaOrdem) {
    setLoadingContatos(true);
    setContatosError(null);
    setOrdemState(novaOrdem);
  }

  function retryContatos() {
    setLoadingContatos(true);
    setContatosError(null);
    carregarContatos();
  }

  useEffect(() => {
    carregarContatos();
  }, [carregarContatos]);

  const [selecionados, setSelecionados] = useState(() => new Set());
  const [selectionError, setSelectionError] = useState(null);

  function toggleSelecionado(contatoId) {
    setSelectionError(null);
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(contatoId)) {
        next.delete(contatoId);
        return next;
      }
      if (next.size >= MAX_CONTATOS_POR_DISPARO) {
        setSelectionError(`Máximo de ${MAX_CONTATOS_POR_DISPARO} contatos por disparo.`);
        return prev;
      }
      next.add(contatoId);
      return next;
    });
  }

  const [disparando, setDisparando] = useState(false);
  const [disparoError, setDisparoError] = useState(null);
  const [avisos, setAvisos] = useState(null);
  const [confirmandoAvisos, setConfirmandoAvisos] = useState(false);
  const [avisosError, setAvisosError] = useState(null);

  function efetivarDisparo() {
    return criarDisparo(token, {
      estadoId: estado.id,
      numeroRemetenteId: Number(numeroRemetenteId),
      contatoIds: Array.from(selecionados),
    }).then(() => {
      setSelecionados(new Set());
      setSelectionError(null);
      onFlash('Disparo registrado.');
      carregarContatos();
    });
  }

  function handleDisparar() {
    if (selecionados.size === 0 || !numeroRemetenteId) return;

    setDisparando(true);
    setDisparoError(null);
    verificarDisparo(token, {
      estadoId: estado.id,
      numeroRemetenteId: Number(numeroRemetenteId),
      contatoIds: Array.from(selecionados),
    })
      .then((resultado) => {
        if (resultado?.avisos?.length > 0) {
          setAvisos(resultado.avisos);
          return;
        }

        return efetivarDisparo();
      })
      .catch((err) => setDisparoError(err.message || 'Erro ao registrar disparo.'))
      .finally(() => setDisparando(false));
  }

  function cancelarAvisos() {
    setAvisos(null);
    setAvisosError(null);
  }

  function confirmarApesarDosAvisos() {
    setConfirmandoAvisos(true);
    setAvisosError(null);
    efetivarDisparo()
      .then(() => setAvisos(null))
      .catch((err) => setAvisosError(err.message || 'Erro ao registrar disparo.'))
      .finally(() => setConfirmandoAvisos(false));
  }

  const semNumeroAtivo = numerosAtivos.length === 0;
  const algumNumeroElegivel = numerosAtivos.some((n) => elegibilidadePorNumero.get(n.id)?.elegivel);
  const nenhumNumeroElegivel = !semNumeroAtivo && !algumNumeroElegivel;
  const disparoDesabilitado = disparando || selecionados.size === 0 || semNumeroAtivo || nenhumNumeroElegivel;
  const numeroSelecionadoElegivel = elegibilidadePorNumero.get(Number(numeroRemetenteId))?.elegivel;
  const numeroSelecionadoDetalhe = numerosDetalhes?.get(Number(numeroRemetenteId));

  return (
    <div className={card}>
      {avisos ? (
        <AvisosModal
          avisos={avisos}
          confirmando={confirmandoAvisos}
          erro={avisosError}
          onCancelar={cancelarAvisos}
          onConfirmar={confirmarApesarDosAvisos}
        />
      ) : null}

      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="pd-font-serif text-[18px] font-bold leading-tight">{estado.nome}</h2>
          <span className="text-[11.5px] text-[var(--pd-text-secondary)]">{estado.uf}</span>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--pd-surface-alt)] border border-[var(--pd-border)]/60 px-2.5 py-1 text-[12px] font-semibold text-[var(--pd-text-primary)]">
          {totalContatos} contato(s) disponível(is)
        </span>
      </div>

      {semNumeroAtivo ? (
        <div className="mb-3 rounded-lg border border-[var(--pd-border)]/60 bg-[var(--pd-surface-alt)] px-3 py-2.5 text-[12.5px] text-[var(--pd-text-secondary)]">
          Nenhum número remetente ativo cadastrado para este estado.
        </div>
      ) : (
        <div className="mb-3">
          <label htmlFor={`numero-${estado.id}`} className="mb-1 block text-[11.5px] font-semibold text-[var(--pd-text-secondary)]">
            Número remetente usado neste disparo
          </label>
          <div className="flex items-center gap-2">
            <select
              id={`numero-${estado.id}`}
              className={selectCls}
              value={numeroRemetenteId}
              onChange={(e) => setNumeroRemetenteIdManual(e.target.value)}
            >
              {numerosAtivos.map((n) => {
                const info = elegibilidadePorNumero.get(n.id);
                return (
                  <option key={n.id} value={n.id} disabled={!info?.elegivel}>
                    {n.apelido}{info?.motivo ? ` (${info.motivo})` : ''}
                  </option>
                );
              })}
            </select>
            {numerosAtivos.find((n) => String(n.id) === numeroRemetenteId) ? (
              <StatusConexaoBadge
                status={numerosAtivos.find((n) => String(n.id) === numeroRemetenteId).statusConexao}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-[var(--pd-text-secondary)]">
            A escolha acima não filtra a fila abaixo, a lista de contatos é sempre a do estado inteiro.
          </p>
          {nenhumNumeroElegivel ? (
            <div className="mt-2 rounded-lg border border-[var(--pd-border)]/60 bg-[var(--pd-surface-alt)] px-3 py-2.5 text-[12.5px] text-[var(--pd-text-secondary)]">
              Nenhum número deste estado está pronto para disparo. Configure a conexão e o nome da colaboradora em Configurações.
            </div>
          ) : null}
          {numeroSelecionadoElegivel && numeroSelecionadoDetalhe?.numero ? (
            <div className="mt-2 rounded-lg border border-[var(--pd-success)]/30 bg-[var(--pd-success-bg)] px-3 py-2.5 text-[13px] text-[var(--pd-success)]">
              📱 {numeroSelecionadoDetalhe.numero} · Atendido por {numeroSelecionadoDetalhe.nomeColaboradora}
            </div>
          ) : null}
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          className={`${inputCls} sm:flex-1`}
          placeholder="Buscar por nome ou telefone..."
          aria-label={`Buscar contatos de ${estado.nome}`}
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
        />
        <select
          className={`${selectCls} sm:w-[170px]`}
          aria-label={`Ordenar contatos de ${estado.nome}`}
          value={ordemState}
          onChange={(e) => setOrdem(e.target.value)}
        >
          {ORDENS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="mb-3 max-h-[280px] overflow-y-auto rounded-lg border border-[var(--pd-border)]">
        {loadingContatos ? (
          <div className="px-3 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">Carregando contatos...</div>
        ) : contatosError ? (
          <div className="flex flex-col items-stretch gap-2.5 px-3 py-4 text-[13px] text-[var(--pd-danger)]">
            <span className="break-words">Não foi possível carregar os contatos deste estado.</span>
            <button type="button" className={btnGhost} onClick={retryContatos}>Tentar novamente</button>
          </div>
        ) : contatos.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-[var(--pd-text-secondary)]">
            Nenhum contato disponível neste estado.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--pd-border)]">
            {contatos.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  id={`contato-${estado.id}-${c.id}`}
                  checked={selecionados.has(c.id)}
                  onChange={() => toggleSelecionado(c.id)}
                  className="h-4 w-4 shrink-0 accent-[var(--pd-accent)]"
                />
                <label htmlFor={`contato-${estado.id}-${c.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <div className="truncate text-[13.5px] font-semibold text-[var(--pd-text-primary)]">{c.nome}</div>
                  <div className="text-[12px] text-[var(--pd-text-secondary)]">{c.telefone}</div>
                </label>
                {c.disparadoUltimos3Dias ? <AvisoContatadoBadge /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-[var(--pd-text-primary)]">
          {selecionados.size}/{MAX_CONTATOS_POR_DISPARO} selecionados
        </span>
      </div>

      {selectionError ? (
        <div className="mb-2 text-[12.5px] text-[var(--pd-danger)]">{selectionError}</div>
      ) : null}

      {disparoError ? (
        <div className="mb-2 rounded-lg border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-3 py-2 text-[12.5px] text-[var(--pd-danger)] break-words">
          {disparoError}
        </div>
      ) : null}

      <button
        type="button"
        className={`${btn} mt-auto w-full`}
        disabled={disparoDesabilitado}
        onClick={handleDisparar}
      >
        {disparando ? 'Disparando...' : 'Disparar'}
      </button>
    </div>
  );
}

export default function PainelDisparoPage() {
  const { token } = useAuth();

  const [painel, setPainel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [flashMsg, setFlashMsg] = useState(null);
  const flashTimer = useRef(null);

  function flash(msg, type = 'success') {
    setFlashMsg({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashMsg(null), type === 'error' ? 4200 : 1600);
  }
  const carregarPainel = useCallback(() => {
    fetchPainelDisparo(token)
      .then((lista) => {
        setPainel(lista || []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar painel de disparo.'))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    carregarPainel();
  }, [carregarPainel]);

  const [numerosDetalhes, setNumerosDetalhes] = useState(null);

  const carregarNumerosDetalhes = useCallback(() => {
    fetchNumerosRemetentes(token)
      .then((lista) => {
        const mapa = new Map();
        (lista || []).forEach((n) => {
          mapa.set(n.id, { statusConexao: n.statusConexao, nomeColaboradora: n.nomeColaboradora, numero: n.numero });
        });
        setNumerosDetalhes(mapa);
      })
      .catch(() => setNumerosDetalhes(new Map()));
  }, [token]);

  useEffect(() => {
    carregarNumerosDetalhes();
  }, [carregarNumerosDetalhes]);

  function retryPainel() {
    setLoading(true);
    setLoadError(null);
    carregarPainel();
  }

  return (
    <div className="painel-disparo-light-theme min-h-screen bg-[var(--pd-bg)] p-4 sm:p-6 text-[var(--pd-text-primary)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-[22px] border-b border-[var(--pd-border)]/60 pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--pd-accent-strong)]">Controle de Ligações</div>
          <h1 className="pd-font-serif mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Painel de Disparo</h1>
        </div>

        {loading ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Carregando...</div>
        ) : loadError ? (
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] px-5 py-4 text-sm text-[var(--pd-danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="break-words">Não foi possível carregar o painel de disparo: {loadError}</span>
            <button className={`${btn} w-full sm:w-auto`} onClick={retryPainel}>Tentar novamente</button>
          </div>
        ) : painel.length === 0 ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--pd-text-secondary)]">Nenhum estado cadastrado.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {painel.map((resumo) => (
              <EstadoDisparoCard
                key={resumo.estado.id}
                token={token}
                resumo={resumo}
                onFlash={flash}
                numerosDetalhes={numerosDetalhes}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--pd-danger)] bg-[var(--pd-danger-bg)] text-[var(--pd-danger)]'
            : 'bg-[var(--pd-accent)] text-white'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
