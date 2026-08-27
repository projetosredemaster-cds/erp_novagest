import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchConversas, fetchMensagens, enviarMensagem, atualizarStatusConversa, abrirStreamConversas } from './conversasApi.js';
import { fetchNumerosRemetentes } from '../configuracoes/controleLigacoesConfigApi.js';
import ModalMotivoPerdido from '../components/ModalMotivoPerdido.jsx';


const RECONEXAO_SSE_MS = 5000;
const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const pillCls = "rounded-full border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const pillToggleAtivoCls = "rounded-full border border-[var(--violet)] bg-[var(--violet)]/15 px-3 py-1.5 text-sm font-semibold text-[var(--violet)] focus:outline-none";

const DEBOUNCE_BUSCA_MS = 400;

const STATUS_LABELS = {
  atendeu: 'Atendeu',
  agendou: 'Agendou',
  nao_atendeu: 'Não atendeu',
  venda: 'Venda',
  perdido: 'Perdido',
};

const STATUS_CONVERSA_OPCOES = [
  { value: '', label: 'Sem status' },
  ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const STATUS_CORES = {
  atendeu: { text: 'text-[var(--teal)]', bg: 'bg-[var(--teal)]/10', border: 'border-[var(--teal)]/40' },
  agendou: { text: 'text-[var(--violet)]', bg: 'bg-[var(--violet)]/10', border: 'border-[var(--violet)]/40' },
  nao_atendeu: { text: 'text-[var(--warning)]', bg: 'bg-[var(--warning-bg)]', border: 'border-[var(--warning)]/40' },
  venda: { text: 'text-[var(--success)]', bg: 'bg-[var(--success-bg)]', border: 'border-[var(--success)]/40' },
  perdido: { text: 'text-[var(--danger)]', bg: 'bg-[var(--danger-bg)]', border: 'border-[var(--danger)]/40' },
};

function corStatus(status) {
  return STATUS_CORES[status] ?? { text: 'text-[var(--muted)]', bg: 'bg-transparent', border: 'border-[var(--border)]' };
}

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

function formatHoraMensagem(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatOrigemAtendimento(atual) {
  if (!atual) return null;
  return `Atendido por: ${atual.apelido}`;
}

function agruparPorData(mensagens) {
  const grupos = [];
  let dataAtual = null;
  mensagens.forEach((m) => {
    const dataStr = new Date(m.criado_em).toLocaleDateString('pt-BR');
    if (dataStr !== dataAtual) {
      dataAtual = dataStr;
      grupos.push({ tipo: 'divider', data: dataStr, key: `divider-${m.id}` });
    }
    grupos.push({ tipo: 'mensagem', mensagem: m, key: `msg-${m.id}` });
  });
  return grupos;
}

function ConversaItem({ conversa, selecionada, onSelecionar }) {
  const { contato, ultimaMensagem, naoLidas, numeroRemetenteInicial } = conversa;

  return (
    <button
      type="button"
      onClick={onSelecionar}
      aria-pressed={selecionada}
      className={`block w-full border-b border-[var(--border)] px-3 py-3 text-left transition-colors ${
        selecionada ? 'border-l-2 border-l-[var(--violet)] bg-[var(--panel-alt)]' : 'hover:bg-[var(--panel-alt)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-[var(--text)]">{contato.nome}</div>
          <div className="text-[11.5px] text-[var(--muted)]">{contato.telefone}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-[11px] text-[var(--muted)]">{formatRelativo(ultimaMensagem?.criado_em)}</span>
          {naoLidas > 0 ? (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[var(--violet)] px-1.5 text-[10.5px] font-bold text-[#0b1010]">
              {naoLidas}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-1 truncate text-[12.5px] text-[var(--muted)]">
        {ultimaMensagem?.corpo || '—'}
      </div>
      {}
      {numeroRemetenteInicial || conversa.status ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {numeroRemetenteInicial ? (
            <span className="inline-block truncate rounded-full bg-[var(--violet)]/20 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--violet)]">
              {numeroRemetenteInicial.apelido}
            </span>
          ) : null}
          {conversa.status ? (
            <span className={`inline-block truncate rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${corStatus(conversa.status).border} ${corStatus(conversa.status).bg} ${corStatus(conversa.status).text}`}>
              {STATUS_LABELS[conversa.status] ?? conversa.status}
            </span>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}

function IconClock({ size, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconCheck({ size, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconCheckCheck({ size, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="18 6 7 17 2 12" />
      <polyline points="22 6 11 17 10.5 16.5" />
    </svg>
  );
}

function IconAlertCircle({ size, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function StatusEntregaIcone({ status }) {
  const tamanho = 13;
  switch (status) {
    case 'pendente':
      return <IconClock size={tamanho} className="text-[var(--muted)]" />;
    case 'enviado':
      return <IconCheck size={tamanho} className="text-[var(--muted)]" />;
    case 'entregue':
      return <IconCheckCheck size={tamanho} className="text-[var(--muted)]" />;
    case 'lido':
      return <IconCheckCheck size={tamanho} className="text-blue-400" />;
    case 'erro':
      return <IconAlertCircle size={tamanho} className="text-[var(--danger)]" />;
    default:
      return null;
  }
}

function ChatBubble({ mensagem }) {
  const alinhamento = mensagem.remetente === 'cliente' ? 'justify-start' : 'justify-end';
  const bubbleColor =
    mensagem.remetente === 'cliente'
      ? 'bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)]'
      : mensagem.remetente === 'ia'
        ? 'bg-[var(--violet)]/20 text-[var(--text)]'
        : 'bg-[var(--violet)] text-[#0b1010]';
  const horaColor = ['atendente', 'colaboradora'].includes(mensagem.remetente) ? 'text-[#0b1010]/70' : 'text-[var(--muted)]';

  return (
    <div className={`flex ${alinhamento}`}>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[13.5px] ${bubbleColor}`}>
        <div className="whitespace-pre-wrap break-words">{mensagem.corpo}</div>
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10.5px] ${horaColor}`}>
          <span>{formatHoraMensagem(mensagem.criado_em)}</span>
          {mensagem.remetente !== 'cliente' ? <StatusEntregaIcone status={mensagem.status_entrega} /> : null}
        </div>
      </div>
    </div>
  );
}

export default function ConversasPage() {
  const { token } = useAuth();
  const { refetchNotificacoes } = useOutletContext() ?? {};
  const location = useLocation();
  const navigate = useNavigate();
  const [conversas, setConversas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [buscaInput, setBuscaInput] = useState('');
  const [busca, setBusca] = useState('');
  const ultimaBuscaAplicadaRef = useRef('');
  const [numerosRemetentes, setNumerosRemetentes] = useState([]);
  const [filtroNumeroRemetenteId, setFiltroNumeroRemetenteId] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [ocultarVendas, setOcultarVendas] = useState(false);

  useEffect(() => {
    fetchNumerosRemetentes(token)
      .then((lista) => setNumerosRemetentes((lista || []).filter((n) => n.ativo)))
      .catch(() => setNumerosRemetentes([]));
  }, [token]);

  const carregarConversas = useCallback(() => (
    fetchConversas(token, { busca, numeroRemetenteId: filtroNumeroRemetenteId, status: filtroStatus })
      .then((lista) => {
        setConversas(lista || []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar conversas.'))
      .finally(() => setLoading(false))
  ), [token, busca, filtroNumeroRemetenteId, filtroStatus]);

  const carregarConversasRef = useRef(carregarConversas);
  useEffect(() => {
    carregarConversasRef.current = carregarConversas;
  }, [carregarConversas]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const valorTrimado = buscaInput.trim();
      if (valorTrimado === ultimaBuscaAplicadaRef.current) return;
      ultimaBuscaAplicadaRef.current = valorTrimado;
      setLoading(true);
      setLoadError(null);
      setBusca(valorTrimado);
    }, DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(timer);
  }, [buscaInput]);

  useEffect(() => {
    carregarConversas();
  }, [carregarConversas]);

  function retryConversas() {
    setLoading(true);
    setLoadError(null);
    carregarConversas();
  }

  function handleAtualizar() {
    setLoading(true);
    setLoadError(null);
    carregarConversas();
  }

  function handleChangeFiltroNumeroRemetente(e) {
    setLoading(true);
    setLoadError(null);
    setFiltroNumeroRemetenteId(e.target.value);
  }

  function handleChangeFiltroStatus(e) {
    setLoading(true);
    setLoadError(null);
    setFiltroStatus(e.target.value);
  }

  function handleLimparFiltros() {
    setLoading(true);
    setLoadError(null);
    setBuscaInput('');
    ultimaBuscaAplicadaRef.current = '';
    setBusca('');
    setFiltroNumeroRemetenteId('');
    setFiltroStatus('');
    setOcultarVendas(false);
  }

  const [contatoSelecionado, setContatoSelecionado] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const [mensagensError, setMensagensError] = useState(null);
  const [textoEnvio, setTextoEnvio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [envioError, setEnvioError] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [modalMotivoAberto, setModalMotivoAberto] = useState(false);
  const contatoSelecionadoRef = useRef(contatoSelecionado);
  useEffect(() => {
    contatoSelecionadoRef.current = contatoSelecionado;
  }, [contatoSelecionado]);

  function carregarMensagens(contatoId, numeroRemetenteId) {
    setLoadingMensagens(true);
    setMensagensError(null);
    return fetchMensagens(token, contatoId, numeroRemetenteId)
      .then((resposta) => {
        setMensagens(resposta?.mensagens || []);
        setMensagensError(null);
        setConversas((prev) => prev.map((c) => (
          c.contato.id === contatoId && c.numeroRemetenteAtual?.id === numeroRemetenteId
            ? { ...c, naoLidas: 0 }
            : c
        )));
        refetchNotificacoes?.();
      })
      .catch((err) => setMensagensError(err.message || 'Erro ao carregar mensagens.'))
      .finally(() => setLoadingMensagens(false));
  }

  function selecionarConversaContato(contato) {
    setContatoSelecionado(contato);
    setMensagens([]);
    setMensagensError(null);
    setEnvioError(null);
    setStatusError(null);
    setTextoEnvio('');
    carregarMensagens(contato.id, contato.numeroRemetenteId);
  }

  function selecionarConversa(conversa) {
    selecionarConversaContato({ ...conversa.contato, numeroRemetenteId: conversa.numeroRemetenteAtual.id });
  }

  function retryMensagens() {
    if (!contatoSelecionado) return;
    carregarMensagens(contatoSelecionado.id, contatoSelecionado.numeroRemetenteId);
  }

  useEffect(() => {
    if (!location.state?.contatoId) return undefined;
    const { contatoId, numeroRemetenteId, nome, telefone } = location.state;
    const timer = setTimeout(() => {
      selecionarConversaContato({ id: contatoId, numeroRemetenteId, nome, telefone });
      navigate(location.pathname, { replace: true, state: null });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  useEffect(() => {
    let montado = true;
    let controller = null;
    let reconnectTimer = null;

    function conectar() {
      controller = new AbortController();
      abrirStreamConversas(token, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (!data) return;

          if (event === 'nova-mensagem') {
            carregarConversasRef.current();
            if (
              contatoSelecionadoRef.current?.id === data.contatoId &&
              contatoSelecionadoRef.current?.numeroRemetenteId === data.numeroRemetenteId
            ) {
              carregarMensagens(data.contatoId, data.numeroRemetenteId);
            }
            return;
          }

          if (event === 'status-atualizado') {
            if (
              contatoSelecionadoRef.current?.id !== data.contatoId ||
              contatoSelecionadoRef.current?.numeroRemetenteId !== data.numeroRemetenteId
            ) {
              return;
            }
            setMensagens((atual) => atual.map((m) => (
              m.baileys_message_id === data.baileysMessageId
                ? { ...m, status_entrega: data.status }
                : m
            )));
          }
        },
      }).catch((err) => {
        if (err?.name === 'AbortError') return;
        if (!montado) return;
        reconnectTimer = setTimeout(() => {
          if (montado) conectar();
        }, RECONEXAO_SSE_MS);
      });
    }

    conectar();

    return () => {
      montado = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller?.abort();
    };
  }, [token]);

  function handleEnviar(e) {
    e.preventDefault();
    const corpo = textoEnvio.trim();
    if (!corpo || !contatoSelecionado || enviando) return;

    setEnviando(true);
    setEnvioError(null);
    enviarMensagem(token, contatoSelecionado.id, contatoSelecionado.numeroRemetenteId, corpo)
      .then((mensagemSalva) => {
        setMensagens((prev) => [...prev, mensagemSalva]);
        setTextoEnvio('');
      })
      .catch((err) => {
        const msg = err.message || '';
        setEnvioError(
          msg === 'Número não está conectado.'
            ? 'O número usado nesta conversa está desconectado. Reconecte-o em Configurações antes de responder.'
            : (msg || 'Erro ao enviar mensagem.')
        );
      })
      .finally(() => setEnviando(false));
  }

  function aplicarNovoStatus(novoStatus, motivo = null, motivoDetalhe = null) {
    if (!contatoSelecionado) return;
    const { id: contatoId, numeroRemetenteId } = contatoSelecionado;
    setStatusError(null);
    atualizarStatusConversa(token, contatoId, numeroRemetenteId, novoStatus, motivo, motivoDetalhe)
      .then(() => {
        setConversas((prev) => prev.map((c) => (
          c.contato.id === contatoId && c.numeroRemetenteAtual?.id === numeroRemetenteId
            ? { ...c, status: novoStatus }
            : c
        )));
      })
      .catch((err) => {
        console.error('Erro ao atualizar status da conversa:', err);
        setStatusError(err.message || 'Erro ao atualizar status.');
      });
  }

  function handleAlterarStatus(novoStatus) {
    if (!contatoSelecionado) return;
    if (novoStatus === 'perdido') {
      setModalMotivoAberto(true);
      return;
    }
    aplicarNovoStatus(novoStatus);
  }

  const conversaAberta = conversas.find((c) => (
    c.contato.id === contatoSelecionado?.id && c.numeroRemetenteAtual?.id === contatoSelecionado?.numeroRemetenteId
  ));
  const numeroRemetenteAtualConversa = conversaAberta?.numeroRemetenteAtual ?? null;
  const origemAtendimento = formatOrigemAtendimento(numeroRemetenteAtualConversa);

  const grupos = agruparPorData(mensagens);
  const conversasExibidas = ocultarVendas ? conversas.filter((c) => c.status !== 'venda') : conversas;

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)] p-4 text-[var(--text)] sm:p-6">
      {modalMotivoAberto ? (
        <ModalMotivoPerdido
          onConfirmar={(motivo, motivoDetalhe) => {
            setModalMotivoAberto(false);
            aplicarNovoStatus('perdido', motivo, motivoDetalhe);
          }}
          onCancelar={() => setModalMotivoAberto(false)}
        />
      ) : null}

      <div className="mb-4 border-b border-[var(--border)] pb-[18px]">
        <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
        <h1 className="font-display mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Conversas</h1>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {}
        <div className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] p-3">
            <div className="flex items-center gap-2">
              <input
                type="search"
                className={`${inputCls} flex-1`}
                placeholder="Buscar por nome ou telefone..."
                aria-label="Buscar conversas"
                value={buscaInput}
                onChange={(e) => setBuscaInput(e.target.value)}
              />
              <button type="button" className={btnGhost} onClick={handleAtualizar} disabled={loading}>
                {loading ? '...' : 'Atualizar'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                className={pillCls}
                aria-label="Filtrar por atendente"
                value={filtroNumeroRemetenteId}
                onChange={handleChangeFiltroNumeroRemetente}
              >
                <option value="">Geral</option>
                {numerosRemetentes.map((n) => (
                  <option key={n.id} value={n.id}>{n.apelido}</option>
                ))}
              </select>

              <select
                className={pillCls}
                aria-label="Filtrar por status"
                value={filtroStatus}
                onChange={handleChangeFiltroStatus}
              >
                {STATUS_CONVERSA_OPCOES.map((opcao, idx) => (
                  <option key={opcao.value} value={opcao.value}>
                    {idx === 0 ? 'Todos os status' : opcao.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={ocultarVendas ? pillToggleAtivoCls : pillCls}
                aria-pressed={ocultarVendas}
                onClick={() => setOcultarVendas((atual) => !atual)}
              >
                Ocultar vendas
              </button>

              <button type="button" className={pillCls} onClick={handleLimparFiltros}>
                Limpar
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && conversas.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">Carregando...</div>
            ) : loadError ? (
              <div className="flex flex-col items-stretch gap-2.5 px-3 py-6 text-[13px] text-[var(--danger)]">
                <span className="break-words">Não foi possível carregar as conversas: {loadError}</span>
                <button type="button" className={btnGhost} onClick={retryConversas}>Tentar novamente</button>
              </div>
            ) : conversasExibidas.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nenhuma conversa ainda.</div>
            ) : (
              <ul>
                {conversasExibidas.map((c) => (
                  <li key={`${c.contato.id}-${c.numeroRemetenteAtual?.id}`}>
                    <ConversaItem
                      conversa={c}
                      selecionada={
                        contatoSelecionado?.id === c.contato.id &&
                        contatoSelecionado?.numeroRemetenteId === c.numeroRemetenteAtual?.id
                      }
                      onSelecionar={() => selecionarConversa(c)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {}
        <div className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          {!contatoSelecionado ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
              Selecione uma conversa na lista ao lado para visualizar o histórico.
            </div>
          ) : (
            <>
              <div className="border-b border-[var(--border)] px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[14.5px] font-semibold text-[var(--text)]">{contatoSelecionado.nome}</div>
                    <div className="text-[12px] text-[var(--muted)]">{contatoSelecionado.telefone}</div>
                    {origemAtendimento ? (
                      <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">{origemAtendimento}</div>
                    ) : null}
                  </div>
                  <label className="flex flex-col items-end gap-1 text-[11px] text-[var(--muted)]">
                    <span>Status da conversa</span>
                    <select
                      className={`w-auto rounded-lg border px-3 py-1.5 text-[12.5px] font-medium focus:outline-none focus:border-[var(--violet)] ${corStatus(conversaAberta?.status).border} ${corStatus(conversaAberta?.status).bg} ${corStatus(conversaAberta?.status).text}`}
                      aria-label="Status da conversa"
                      value={conversaAberta?.status ?? ''}
                      onChange={(e) => handleAlterarStatus(e.target.value)}
                    >
                      {STATUS_CONVERSA_OPCOES.map((opcao) => (
                        <option key={opcao.value} value={opcao.value} disabled={opcao.value === 'atendeu'}>{opcao.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {statusError ? (
                  <div className="mt-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-1.5 text-[12px] text-[var(--danger)] break-words">
                    {statusError}
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {loadingMensagens ? (
                  <div className="px-1 py-8 text-center text-sm text-[var(--muted)]">Carregando mensagens...</div>
                ) : mensagensError ? (
                  <div className="flex flex-col items-stretch gap-2.5 text-[13px] text-[var(--danger)]">
                    <span className="break-words">Não foi possível carregar as mensagens: {mensagensError}</span>
                    <button type="button" className={btnGhost} onClick={retryMensagens}>Tentar novamente</button>
                  </div>
                ) : mensagens.length === 0 ? (
                  <div className="px-1 py-8 text-center text-sm text-[var(--muted)]">Nenhuma mensagem ainda.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {grupos.map((item) => (
                      item.tipo === 'divider' ? (
                        <div key={item.key} className="my-2 flex items-center gap-3">
                          <div className="h-px flex-1 bg-[var(--border)]" />
                          <span className="text-[11px] font-semibold text-[var(--muted)]">{item.data}</span>
                          <div className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                      ) : (
                        <ChatBubble key={item.key} mensagem={item.mensagem} />
                      )
                    ))}
                  </div>
                )}
              </div>

              <form onSubmit={handleEnviar} className="border-t border-[var(--border)] p-3">
                {envioError ? (
                  <div className="mb-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--danger)] break-words">
                    {envioError}
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    className={`${inputCls} min-h-[44px] flex-1 resize-none`}
                    placeholder="Digite uma mensagem..."
                    aria-label="Mensagem para o contato"
                    value={textoEnvio}
                    onChange={(e) => setTextoEnvio(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleEnviar(e);
                      }
                    }}
                  />
                  <button type="submit" className={btn} disabled={enviando || !textoEnvio.trim()}>
                    {enviando ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
