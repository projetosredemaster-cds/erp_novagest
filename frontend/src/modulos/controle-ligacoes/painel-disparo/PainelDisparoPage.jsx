// style-system: Tailwind
// Painel de Disparo (CONTRATO-CONTROLE-LIGACOES-API.md, adendo "Painel de
// Disparo (v3)", seções 12-14). Um card por Estado: escolha manual de qual
// número remetente ativo está sendo usado NESTE disparo (a escolha nunca
// filtra a lista de contatos abaixo, que é sempre a do Estado inteiro — essa
// é a decisão de negócio central do contrato), filtro de busca/ordenação da
// fila de contatos, seleção de até 10 contatos e registro da intenção de
// disparo via POST /disparos (não envia nada de fato — worker de envio é
// fase futura, fora de escopo).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../app/AuthContext.jsx';
import { fetchPainelDisparo, fetchContatosDisponiveis, verificarDisparo, criarDisparo } from './painelDisparoApi.js';

const btn = "bg-[var(--violet)] text-[#0b1010] border-none rounded-lg px-4 py-3 sm:px-3.5 sm:py-1.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "bg-transparent border border-[var(--border)] text-[var(--text)] rounded-lg px-3.5 py-2.5 sm:px-3 sm:py-1.5 text-[13px] font-semibold cursor-pointer hover:bg-[var(--panel-alt)] disabled:cursor-not-allowed disabled:opacity-50";
const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const selectCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-2.5 py-2.5 sm:py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--violet)]";
const card = "bg-[var(--panel)] border border-[var(--border)] rounded-2xl px-4 pt-5 pb-[22px] sm:px-5 flex flex-col";

const ORDENS = [
  { value: 'nome_asc', label: 'Nome (A-Z)' },
  { value: 'nome_desc', label: 'Nome (Z-A)' },
  { value: 'recentes', label: 'Mais recentes' },
];

const DEBOUNCE_BUSCA_MS = 400;
const MAX_CONTATOS_POR_DISPARO = 10;

function StatusConexaoBadge({ status }) {
  const label = status === 'aguardando_conexao' ? 'Aguardando conexão' : status;
  return (
    <span className="w-fit shrink-0 rounded-full bg-[var(--gold)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--gold)]">
      {label}
    </span>
  );
}

function AvisoContatadoBadge() {
  return (
    <span className="w-fit shrink-0 rounded-full border border-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--gold)]">
      Contatado há menos de 3 dias
    </span>
  );
}

// Modal exibido ANTES de gravar, quando POST /disparos/verificar volta com
// avisos não vazios — nesse ponto nada foi persistido ainda (verificar não
// grava nada). O usuário decide: "Cancelar" (desiste, nada é gravado) ou
// "Disparar mesmo assim" (só aí chama POST /disparos de verdade).
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
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="avisos-modal-title" className="font-display mb-2 text-[18px] font-bold text-[var(--gold)]">
          Aviso antes de disparar
        </h2>
        <p className="mb-3 text-[13px] text-[var(--muted)]">
          Os contatos abaixo já foram contatados nos últimos 3 dias. Deseja prosseguir com o disparo mesmo assim?
        </p>
        <ul className="mb-4 flex flex-col gap-1.5">
          {avisos.map((c) => (
            <li key={c.contatoId} className="rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2 text-[13px]">
              <span className="font-semibold text-[var(--text)]">{c.nome}</span>
              <span className="ml-2 text-[var(--muted)]">{c.telefone}</span>
            </li>
          ))}
        </ul>
        {erro ? (
          <div className="mb-3 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--danger)] break-words">
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

function EstadoDisparoCard({ token, resumo, onFlash }) {
  const { estado, totalContatos, numerosAtivos } = resumo;

  const [numeroRemetenteId, setNumeroRemetenteId] = useState(
    numerosAtivos.length > 0 ? String(numerosAtivos[0].id) : ''
  );

  const estadoId = estado.id;

  // `busca`/`ordem` são estados primitivos separados (não um objeto
  // `{ busca, ordem }` único) de propósito: dependência de efeito precisa
  // ser um valor primitivo estável para o React comparar com `Object.is` —
  // um objeto literal recriado a cada render (ou recriado a cada chamada de
  // `setFiltros`, mesmo via updater funcional) muda de referência mesmo
  // quando o conteúdo é idêntico, e é a causa mais comum de efeito rodando
  // em loop. `buscaInput` é o valor "cru" digitado; `busca` só é atualizado
  // (com debounce) 400ms depois do usuário parar de digitar.
  const [buscaInput, setBuscaInput] = useState('');
  const [busca, setBusca] = useState('');
  const [ordemState, setOrdemState] = useState('nome_asc');

  // Guarda o último valor de `busca` efetivamente "commitado" (aplicado de
  // verdade num carregamento). Necessário porque o efeito de debounce abaixo
  // depende de `[buscaInput]`, que já começa em `''` — ou seja, o efeito
  // sempre roda também na montagem inicial, mesmo sem o usuário ter digitado
  // nada. Sem essa checagem, o timer de 400ms força setLoadingContatos(true)
  // incondicionalmente; como `busca` já é `''` (estado inicial) o
  // setBusca('') vira no-op (Object.is bail-out), `carregarContatos` não
  // muda de referência, o efeito de fetch não roda de novo, e o card fica
  // travado em "Carregando contatos..." para sempre. Inicializado com o
  // mesmo valor inicial de `busca` (`''`).
  const ultimaBuscaAplicadaRef = useRef('');

  // loadingContatos/contatosError começam já com o valor certo para a carga
  // inicial (true/null) — outras chamadas (busca com debounce, troca de
  // ordenação, "Tentar novamente") resetam os dois no próprio disparador da
  // mudança (handler de evento ou callback de setTimeout), nunca de forma
  // síncrona dentro do corpo do useEffect de busca (abaixo): o
  // eslint-plugin-react-hooks (regra `set-state-in-effect`) proíbe setState
  // síncrono direto no corpo de um efeito, exatamente para evitar o padrão
  // que causa render em cascata/loop.
  const [contatos, setContatos] = useState([]);
  const [loadingContatos, setLoadingContatos] = useState(true);
  const [contatosError, setContatosError] = useState(null);

  // Ignora resposta de uma chamada que ficou obsoleta (ex.: usuário troca a
  // ordenação antes da resposta da busca anterior voltar) — sem isso, uma
  // resposta antiga chegando depois de uma mais nova poderia sobrescrever o
  // resultado correto já exibido. Não depende de nenhuma opção de
  // cancelamento no fetch, só compara "essa ainda é a chamada mais recente?"
  // no momento em que a Promise resolve.
  const requestIdRef = useRef(0);

  // Memoizado com useCallback, dependências 100% primitivas
  // (token/estadoId/busca/ordemState) — a única forma de o efeito abaixo
  // rodar de novo é uma dessas primitivas realmente mudar de valor, nunca
  // por causa de uma referência de objeto/função recriada à toa a cada
  // render. Todo setState aqui dentro acontece só nos callbacks assíncronos
  // (.then/.catch/.finally), nunca de forma síncrona no corpo da função.
  const carregarContatos = useCallback(() => {
    const requestId = ++requestIdRef.current;
    fetchContatosDisponiveis(token, estadoId, { busca, ordem: ordemState })
      .then((lista) => {
        if (requestIdRef.current !== requestId) return; // resposta obsoleta
        setContatos(lista || []);
        setContatosError(null); // sucesso sempre limpa um erro anterior
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setContatosError(err.message || 'Erro ao carregar contatos.');
      })
      .finally(() => {
        // Encerra o loading sempre (sucesso ou erro) — nunca só no caminho
        // feliz — mas só para a chamada que ainda é a mais recente; uma
        // chamada obsoleta não deve "reabrir" o loading depois que uma mais
        // nova já terminou.
        if (requestIdRef.current !== requestId) return;
        setLoadingContatos(false);
      });
  }, [token, estadoId, busca, ordemState]);

  // Debounce: só atualiza `busca` (e por consequência dispara o efeito
  // abaixo, via a mudança de `carregarContatos`) 400ms depois do usuário
  // parar de digitar. O reset de loading/erro acontece aqui, dentro do
  // callback do setTimeout — não dentro do corpo do useEffect. Esse efeito
  // roda também na montagem inicial (porque `buscaInput` já começa em `''`),
  // então o callback só prossegue (loading/erro/busca) quando o valor
  // trimado realmente difere do último valor já aplicado — evita reabrir o
  // loading sem nunca reagendar um fetch (ver comentário no ref acima).
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

  // Roda na carga inicial e sempre que busca/ordem mudarem de verdade —
  // nunca em loop, porque `carregarContatos` só muda de referência quando
  // uma das primitivas de que depende muda. Não faz setState síncrono aqui
  // dentro (só delega para uma função cujo próprio setState é sempre
  // assíncrono, em callbacks de Promise).
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

  // Efetiva o disparo de verdade (POST /disparos) e trata o pós-sucesso comum
  // aos dois caminhos possíveis (sem aviso, ou "Disparar mesmo assim" depois
  // de aviso): flash de sucesso, limpar seleção do card e rechamar
  // carregarContatos() pra badge "Contatado há menos de 3 dias" refletir o
  // disparo recém-criado sem precisar recarregar a página.
  function efetivarDisparo() {
    return criarDisparo(token, {
      estadoId: estado.id,
      numeroRemetenteId: Number(numeroRemetenteId),
      contatoIds: Array.from(selecionados),
    }).then(() => {
      setSelecionados(new Set());
      setSelectionError(null);
      onFlash('Disparo registrado.');
      carregarContatos(); // dispara em paralelo, não precisa aguardar
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
          // Há aviso: não grava nada ainda, abre o modal e preserva a
          // seleção intacta (usuário pode desmarcar os avisados e tentar de
          // novo, ou cancelar).
          setAvisos(resultado.avisos);
          return;
        }
        // Sem aviso: efetiva o disparo automaticamente, sem exigir um
        // segundo clique do usuário.
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
  const disparoDesabilitado = disparando || selecionados.size === 0 || semNumeroAtivo;

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
          <h2 className="font-display text-[18px] font-bold leading-tight">{estado.nome}</h2>
          <span className="text-[11.5px] text-[var(--muted)]">{estado.uf}</span>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--panel-alt)] border border-[var(--border)] px-2.5 py-1 text-[12px] font-semibold text-[var(--text)]">
          {totalContatos} contato(s) disponível(is)
        </span>
      </div>

      {semNumeroAtivo ? (
        <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2.5 text-[12.5px] text-[var(--muted)]">
          Nenhum número remetente ativo cadastrado para este estado.
        </div>
      ) : (
        <div className="mb-3">
          <label htmlFor={`numero-${estado.id}`} className="mb-1 block text-[11.5px] font-semibold text-[var(--muted)]">
            Número remetente usado neste disparo
          </label>
          <div className="flex items-center gap-2">
            <select
              id={`numero-${estado.id}`}
              className={selectCls}
              value={numeroRemetenteId}
              onChange={(e) => setNumeroRemetenteId(e.target.value)}
            >
              {numerosAtivos.map((n) => (
                <option key={n.id} value={n.id}>{n.apelido}</option>
              ))}
            </select>
            {numerosAtivos.find((n) => String(n.id) === numeroRemetenteId) ? (
              <StatusConexaoBadge
                status={numerosAtivos.find((n) => String(n.id) === numeroRemetenteId).statusConexao}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            A escolha acima não filtra a fila abaixo — a lista de contatos é sempre a do estado inteiro.
          </p>
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

      <div className="mb-3 max-h-[280px] overflow-y-auto rounded-lg border border-[var(--border)]">
        {loadingContatos ? (
          <div className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">Carregando contatos...</div>
        ) : contatosError ? (
          <div className="flex flex-col items-stretch gap-2.5 px-3 py-4 text-[13px] text-[var(--danger)]">
            <span className="break-words">Não foi possível carregar os contatos deste estado.</span>
            <button type="button" className={btnGhost} onClick={retryContatos}>Tentar novamente</button>
          </div>
        ) : contatos.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">
            Nenhum contato disponível neste estado.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {contatos.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  id={`contato-${estado.id}-${c.id}`}
                  checked={selecionados.has(c.id)}
                  onChange={() => toggleSelecionado(c.id)}
                  className="h-4 w-4 shrink-0 accent-[var(--violet)]"
                />
                <label htmlFor={`contato-${estado.id}-${c.id}`} className="min-w-0 flex-1 cursor-pointer">
                  <div className="truncate text-[13.5px] font-semibold text-[var(--text)]">{c.nome}</div>
                  <div className="text-[12px] text-[var(--muted)]">{c.telefone}</div>
                </label>
                {c.disparadoUltimos3Dias ? <AvisoContatadoBadge /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-2 flex items-center justify-between text-[12.5px]">
        <span className="font-semibold text-[var(--text)]">
          {selecionados.size}/{MAX_CONTATOS_POR_DISPARO} selecionados
        </span>
      </div>

      {selectionError ? (
        <div className="mb-2 text-[12.5px] text-[var(--danger)]">{selectionError}</div>
      ) : null}

      {disparoError ? (
        <div className="mb-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[12.5px] text-[var(--danger)] break-words">
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

  // Memoizado com useCallback, dependência primitiva só de `token` — mesmo
  // raciocínio do `carregarContatos` de EstadoDisparoCard abaixo: o efeito
  // de carga inicial só roda de novo se `token` realmente mudar de valor.
  // Nenhum setState síncrono aqui dentro (regra `set-state-in-effect`) — só
  // nos callbacks assíncronos de `.then/.catch/.finally`.
  const carregarPainel = useCallback(() => {
    fetchPainelDisparo(token)
      .then((lista) => {
        setPainel(lista || []);
        setLoadError(null); // sucesso sempre limpa um erro anterior
      })
      .catch((err) => setLoadError(err.message || 'Erro ao carregar painel de disparo.'))
      .finally(() => setLoading(false)); // sempre encerra o loading, sucesso ou erro
  }, [token]);

  useEffect(() => {
    carregarPainel();
  }, [carregarPainel]);

  function retryPainel() {
    setLoading(true);
    setLoadError(null);
    carregarPainel();
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 sm:p-6 text-[var(--text)]">
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-[22px] border-b border-[var(--border)] pb-[18px]">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">Controle de Ligações</div>
          <h1 className="font-display mt-0.5 text-[26px] font-extrabold leading-tight sm:text-[34px] sm:leading-none">Painel de Disparo</h1>
        </div>

        {loading ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--muted)]">Carregando...</div>
        ) : loadError ? (
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] px-5 py-4 text-sm text-[var(--danger)] sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="break-words">Não foi possível carregar o painel de disparo: {loadError}</span>
            <button className={`${btn} w-full sm:w-auto`} onClick={retryPainel}>Tentar novamente</button>
          </div>
        ) : painel.length === 0 ? (
          <div className="px-1 py-10 text-center text-sm text-[var(--muted)]">Nenhum estado cadastrado.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {painel.map((resumo) => (
              <EstadoDisparoCard key={resumo.estado.id} token={token} resumo={resumo} onFlash={flash} />
            ))}
          </div>
        )}
      </div>

      <div
        className={`fixed bottom-5 left-4 right-4 sm:left-auto sm:right-5 max-w-[360px] rounded-lg px-4 py-2 text-[13px] font-bold pointer-events-none transition-opacity duration-300 ${
          flashMsg ? 'opacity-100' : 'opacity-0'
        } ${
          flashMsg?.type === 'error'
            ? 'border border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]'
            : 'bg-[var(--violet)] text-[#0b1010]'
        }`}
      >
        {flashMsg?.msg}
      </div>
    </div>
  );
}
