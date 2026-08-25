// style-system: Tailwind
// Central de Mensagens (CONTRATO-CONTROLE-LIGACOES-API.md, seção "Central de
// Mensagens (v7)") — inbox simples de duas colunas: lista de conversas +
// painel de chat. MVP deliberado: só texto, um único operador, sem
// pipeline/etapas, sem transcrição de áudio. Mensagens novas chegam em
// tempo real via SSE (`GET /conversas/stream`, ver `abrirStreamConversas`
// em conversasApi.js) — sem polling, sem indicador visual de "conectado"
// (deve ser transparente pro usuário). O botão "Atualizar" manual continua
// existindo como fallback. O cabeçalho do painel de chat mostra qual número
// remetente iniciou a conversa (`numeroRemetenteInicial`, vindo de
// fetchMensagens) e qual está em uso agora (`numeroRemetenteAtual`, lido da
// lista `conversas` já em estado) — um contato nunca fica travado a um
// único número ao longo do tempo, ver `formatOrigemAtendimento` abaixo.
// Também aceita pré-seleção de conversa via `location.state.contatoId`
// (clique num item do dropdown de notificações do sino em
// ControleLigacoesShell.jsx) — ver o `useEffect` de `location.state` mais
// abaixo, perto de `selecionarConversaContato`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchConversas, fetchMensagens, enviarMensagem, abrirStreamConversas } from './conversasApi.js';

// Tempo de espera antes de tentar reabrir o stream SSE depois de uma queda
// de conexão real (não intencional — ver o `useEffect` de tempo real mais
// abaixo, que distingue isso de um `AbortController.abort()` proposital).
const RECONEXAO_SSE_MS = 5000;

const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";

const DEBOUNCE_BUSCA_MS = 400;

// Horário relativo simples para o preview de cada conversa na lista: "agora"
// (< 1min), "Xmin" (< 1h), "Xh" (< 24h), "Xd" (24h+). Decisão de design: não
// reaproveitei `formatDataHora` de ImportacaoPage.jsx (data+hora absoluta em
// pt-BR) porque o requisito pedia explicitamente algo no estilo "relativo" —
// mais compacto para uma lista de conversas, mesmo padrão visual de inbox
// (WhatsApp Web, Gmail etc).
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

// Horário curto (HH:mm) exibido dentro de cada bolha de chat.
function formatHoraMensagem(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// Agrupa a lista plana de mensagens em itens de renderização, inserindo um
// divisor de data (`toLocaleDateString('pt-BR')`) sempre que o dia muda de
// uma mensagem para a próxima.
// Deixa explícito, no cabeçalho do chat, quando o número que iniciou a
// conversa é diferente do número em uso agora (ver nota no topo do arquivo)
// — um contato nunca fica travado a um único número remetente. `inicial`
// vem de `fetchMensagens`; `atual` vem do item correspondente em `conversas`
// (não da resposta de `fetchMensagens`, que não traz esse campo). Retorna
// `null` quando não há nada relevante a mostrar (sem histórico ainda).
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
      {/* Número remetente que iniciou a conversa (histórico) — linha própria
          abaixo do preview da última mensagem, em formato de "chip" bem
          discreto, para não competir visualmente nem com o nome do contato
          (acima) nem com o `truncate` do preview. Ausente (contato sem
          histórico ainda) simplesmente não renderiza nada, sem quebrar
          layout. Só o apelido de quem iniciou — não a lógica completa de
          "iniciado por"/"atendido por"/"respondendo por" do cabeçalho do
          chat (`formatOrigemAtendimento`), que continua exclusiva de lá. */}
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

// Paleta por remetente (decisão de design, sem instrução exata do prompt):
// 'cliente' à esquerda em tom neutro (--panel-alt/--border), 'ia' à direita
// num tom suave do roxo do módulo (--violet a 20% de opacidade) e
// 'colaboradora' à direita em roxo sólido (mesmo tom do botão primário
// `btn` já usado no resto do módulo) — para ficar claro à primeira vista
// que é uma resposta humana, não automática.
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
  // Vem do `<Outlet context={{ refetchNotificacoes }}/>` de
  // ControleLigacoesShell.jsx (o sino de notificações). Pode vir `undefined`
  // quando este componente é renderizado fora desse Outlet (ex.: os testes
  // existentes, que montam `<ConversasPage/>` isolado) — sempre chamado com
  // optional chaining abaixo, nunca quebra nesse caso.
  const { refetchNotificacoes } = useOutletContext() ?? {};
  const location = useLocation();
  const navigate = useNavigate();

  // --- lista de conversas (coluna esquerda) ---
  const [conversas, setConversas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Mesmo padrão de debounce de busca do Painel de Disparo:
  // `buscaInput`/`busca` separados + ref do último valor aplicado, para o
  // efeito de debounce (que também roda na montagem, já que `buscaInput`
  // começa em `''`) não travar o loading sem nunca reagendar um fetch.
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

  // `carregarConversas` muda de identidade a cada troca de `busca` (deps do
  // `useCallback` acima) — o efeito de tempo real (SSE) mais abaixo só
  // monta uma vez, então lê sempre a versão mais atual através desta ref em
  // vez de capturar a de quando o stream foi aberto (evitaria refazer a
  // busca com o filtro certo depois que o usuário digitasse algo).
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

  // --- painel de chat (coluna direita) ---
  const [contatoSelecionado, setContatoSelecionado] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [loadingMensagens, setLoadingMensagens] = useState(false);
  const [mensagensError, setMensagensError] = useState(null);
  // Número remetente que mandou a primeira mensagem da conversa aberta no
  // momento (histórico, vem de `fetchMensagens`) — `null` enquanto nenhuma
  // conversa está selecionada ou o contato nunca teve mensagem.
  const [numeroRemetenteInicialConversa, setNumeroRemetenteInicialConversa] = useState(null);
  // Estado do rodapé de envio (declarado aqui, mais cedo do que o bloco
  // "--- envio de mensagem ---" mais abaixo onde é usado por `handleEnviar`)
  // porque `selecionarConversaContato`/`selecionarConversa` também precisam
  // resetá-lo, e referenciar um `useState` antes de sua declaração no corpo
  // do componente quebra a regra `react-hooks/immutability` do lint.
  const [textoEnvio, setTextoEnvio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [envioError, setEnvioError] = useState(null);

  // Mesma razão da ref de `carregarConversas` acima: o handler do evento SSE
  // roda dentro de um efeito de longa duração (monta uma vez) e precisa
  // sempre saber qual é a conversa aberta *no momento em que o evento
  // chega*, não a de quando o stream foi aberto (clássico problema de
  // closure obsoleta em listeners de longa duração).
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
        // O backend já marcou como lida como efeito colateral do GET —
        // reflete isso no estado local da lista, sem esperar reload.
        setConversas((prev) => prev.map((c) => (
          c.contato.id === contatoId ? { ...c, naoLidas: 0 } : c
        )));
        // Mesmo ponto: a conversa acabou de ser marcada como lida no
        // servidor — gatilho pedido para recalcular o sino a partir do
        // backend (fonte de verdade), não só o incremento local do SSE.
        refetchNotificacoes?.();
      })
      .catch((err) => setMensagensError(err.message || 'Erro ao carregar mensagens.'))
      .finally(() => setLoadingMensagens(false));
  }

  // Extraído de `selecionarConversa` para poder ser chamado tanto a partir de
  // um item da lista já carregada (`conversa.contato`) quanto a partir de um
  // contato "avulso" vindo de fora da tela (pré-seleção via notificação, ver
  // efeito de `location.state` abaixo) — nesse segundo caso o contato pode
  // nem estar (ainda) na lista `conversas` carregada, então não dá pra
  // depender dela.
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

  // Pré-seleção de conversa vinda de fora da tela (clique num item do
  // dropdown de notificações do sino, em ControleLigacoesShell.jsx) — chega
  // via `navigate(..., { state: { contatoId, nome, telefone } })`. Roda na
  // montagem e sempre que `location.state` mudar de novo (usuário clica em
  // outra notificação estando já na tela de Conversas). Depois de consumir,
  // limpa o state via `navigate(..., { replace:true, state:null })` — sem
  // isso, um refresh da página ou um "voltar" do navegador re-selecionaria a
  // mesma conversa indefinidamente. Acessar a rota direto (sem state) nunca
  // aciona nada aqui, `location.state?.contatoId` fica `undefined`. O
  // trabalho de verdade roda dentro do `setTimeout(...,0)` (não direto no
  // corpo do efeito) — mesma razão documentada em PainelDisparoPage.jsx/
  // ImportacaoPage.jsx: a regra `react-hooks/set-state-in-effect` proíbe
  // setState síncrono direto no corpo de um efeito.
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

  // --- tempo real (SSE) ---
  // Abre a conexão uma única vez ao montar (deps só `[token]`, estável na
  // prática — não deve reabrir por causa de `busca`/`contatoSelecionado`
  // mudando). Ao receber `nova-mensagem`, sempre rebusca a lista de
  // conversas (via a ref acima, sempre com o filtro de busca mais atual) e,
  // só se o contato do evento for o que está aberto no momento (lido pela
  // ref, não pelo valor capturado no mount), também rebusca as mensagens
  // daquele contato — isso já marca como lida no servidor como efeito
  // colateral existente de `carregarMensagens`, que é o comportamento
  // correto para mensagem que chega com a conversa já aberta. Nenhum
  // indicador visual de "conectado" é mostrado — é transparente pro usuário.
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
        // `AbortController.abort()` (cleanup deste efeito, ou reconexão
        // deliberada) rejeita com `AbortError` — não é uma queda real, não
        // deve reconectar.
        if (err?.name === 'AbortError') return;
        // Queda real de conexão: tenta reabrir depois de um tempo, em loop
        // contínuo enquanto o componente estiver montado (não é só 1 retry).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // --- envio de mensagem (rodapé do painel de chat) ---
  // Estado (`textoEnvio`/`enviando`/`envioError`) declarado mais acima,
  // perto de `numeroRemetenteInicialConversa` — ver comentário lá.
  function handleEnviar(e) {
    e.preventDefault();
    const corpo = textoEnvio.trim();
    if (!corpo || !contatoSelecionado || enviando) return;

    setEnviando(true);
    setEnvioError(null);
    enviarMensagem(token, contatoSelecionado.id, corpo)
      .then((mensagemSalva) => {
        // Só limpa o textarea depois de confirmado — em caso de erro, o
        // texto digitado permanece intacto (tratado no .catch abaixo).
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

  // Número em uso agora na conversa aberta — vem da lista `conversas` já em
  // estado (não da resposta de `fetchMensagens`, que só traz o inicial).
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
        {/* coluna esquerda: lista de conversas */}
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

        {/* coluna direita: painel de chat */}
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
