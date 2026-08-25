import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchConversas, fetchMensagens, enviarMensagem, abrirStreamConversas } from './conversasApi.js';


const RECONEXAO_SSE_MS = 5000;
const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";

const DEBOUNCE_BUSCA_MS = 400;

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

function formatOrigemAtendimento(inicial, atual) {
  if (!inicial) return null;
  if (!atual) return `Iniciado por: ${inicial.apelido}`;
  if (inicial.id === atual.id) return `Atendido por: ${inicial.apelido}`;
  return `Iniciado por: ${inicial.apelido} • Respondendo por: ${atual.apelido}`;
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
      {numeroRemetenteInicial ? (
        <div className="mt-1">
          <span className="inline-block truncate rounded border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--muted)]">
            via {numeroRemetenteInicial.apelido}
          </span>
        </div>
      ) : null}
    </button>
  );
}

function ChatBubble({ mensagem }) {
  const alinhamento = mensagem.remetente === 'cliente' ? 'justify-start' : 'justify-end';
  const bubbleColor =
    mensagem.remetente === 'cliente'
      ? 'bg-[var(--panel-alt)] border border-[var(--border)] text-[var(--text)]'
      : mensagem.remetente === 'ia'
        ? 'bg-[var(--violet)]/20 text-[var(--text)]'
        : 'bg-[var(--violet)] text-[#0b1010]';
  const horaColor = mensagem.remetente === 'colaboradora' ? 'text-[#0b1010]/70' : 'text-[var(--muted)]';

  return (
    <div className={`flex ${alinhamento}`}>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-[13.5px] ${bubbleColor}`}>
        <div className="whitespace-pre-wrap break-words">{mensagem.corpo}</div>
        <div className={`mt-1 text-right text-[10.5px] ${horaColor}`}>{formatHoraMensagem(mensagem.criado_em)}</div>
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

  const carregarConversas = useCallback(() => (
    fetchConversas(token, { busca })
      .then((lista) => {
        setConversas(lista || []);
        setLoadError(null);
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar conversas.'))
      .finally(() => setLoading(false))
  ), [token, busca]);

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

  const [contatoSelecionado, setContatoSelecionado] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const [mensagensError, setMensagensError] = useState(null);
  const [numeroRemetenteInicialConversa, setNumeroRemetenteInicialConversa] = useState(null);
  const [textoEnvio, setTextoEnvio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [envioError, setEnvioError] = useState(null);
  const contatoSelecionadoRef = useRef(contatoSelecionado);
  useEffect(() => {
    contatoSelecionadoRef.current = contatoSelecionado;
  }, [contatoSelecionado]);

  function carregarMensagens(contatoId) {
    setLoadingMensagens(true);
    setMensagensError(null);
    return fetchMensagens(token, contatoId)
      .then((resposta) => {
        setMensagens(resposta?.mensagens || []);
        setNumeroRemetenteInicialConversa(resposta?.numeroRemetenteInicial ?? null);
        setMensagensError(null);
        setConversas((prev) => prev.map((c) => (
          c.contato.id === contatoId ? { ...c, naoLidas: 0 } : c
        )));
        refetchNotificacoes?.();
      })
      .catch((err) => setMensagensError(err.message || 'Erro ao carregar mensagens.'))
      .finally(() => setLoadingMensagens(false));
  }

  function selecionarConversaContato(contato) {
    setContatoSelecionado(contato);
    setMensagens([]);
    setNumeroRemetenteInicialConversa(null);
    setMensagensError(null);
    setEnvioError(null);
    setTextoEnvio('');
    carregarMensagens(contato.id);
  }

  function selecionarConversa(conversa) {
    selecionarConversaContato(conversa.contato);
  }

  function retryMensagens() {
    if (!contatoSelecionado) return;
    carregarMensagens(contatoSelecionado.id);
  }

  useEffect(() => {
    if (!location.state?.contatoId) return undefined;
    const { contatoId, nome, telefone } = location.state;
    const timer = setTimeout(() => {
      selecionarConversaContato({ id: contatoId, nome, telefone });
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
          if (event !== 'nova-mensagem' || !data) return;
          carregarConversasRef.current();
          if (contatoSelecionadoRef.current?.id === data.contatoId) {
            carregarMensagens(data.contatoId);
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
    enviarMensagem(token, contatoSelecionado.id, corpo)
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

  const conversaAberta = conversas.find((c) => c.contato.id === contatoSelecionado?.id);
  const numeroRemetenteAtualConversa = conversaAberta?.numeroRemetenteAtual ?? null;
  const origemAtendimento = formatOrigemAtendimento(numeroRemetenteInicialConversa, numeroRemetenteAtualConversa);

  const grupos = agruparPorData(mensagens);

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)] p-4 text-[var(--text)] sm:p-6">
      <div className="mb-4 border-b border-[var(--border)] pb-[18px]">
        <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
        <h1 className="font-display mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Conversas</h1>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {}
        <div className="flex min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
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

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && conversas.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">Carregando...</div>
            ) : loadError ? (
              <div className="flex flex-col items-stretch gap-2.5 px-3 py-6 text-[13px] text-[var(--danger)]">
                <span className="break-words">Não foi possível carregar as conversas: {loadError}</span>
                <button type="button" className={btnGhost} onClick={retryConversas}>Tentar novamente</button>
              </div>
            ) : conversas.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">Nenhuma conversa ainda.</div>
            ) : (
              <ul>
                {conversas.map((c) => (
                  <li key={c.contato.id}>
                    <ConversaItem
                      conversa={c}
                      selecionada={contatoSelecionado?.id === c.contato.id}
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
                <div className="text-[14.5px] font-semibold text-[var(--text)]">{contatoSelecionado.nome}</div>
                <div className="text-[12px] text-[var(--muted)]">{contatoSelecionado.telefone}</div>
                {origemAtendimento ? (
                  <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">{origemAtendimento}</div>
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
