// style-system: Tailwind
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import UserFooterMenu from './UserFooterMenu.jsx';
import { fetchNotificacoes, abrirStreamConversas } from '../modulos/controle-ligacoes/conversas/conversasApi.js';

// Tempo de espera antes de tentar reabrir o stream SSE do sino depois de uma
// queda de conexão real (não intencional) — mesmo valor/racional de
// ConversasPage.jsx, que mantém sua própria conexão SSE independente desta.
const RECONEXAO_SSE_MS = 5000;

const navItemClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-[var(--violet)] text-[#0b1010]'
      : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
  }`;

// Itens do flyout de "Configurações" — painel próprio flutuando à direita
// do botão (não mais um submenu embutido no fluxo vertical da sidebar), daí
// não ter mais o `pl-8` de indentação que `subNavItemClass` usava antes.
const flyoutItemClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-[var(--violet)] text-[#0b1010]'
      : 'text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
  }`;

// Horário relativo ("agora"/"Xmin"/"Xh"/"Xd") exibido em cada item do
// dropdown de notificações — mesmo estilo/racional de `formatRelativo` em
// ConversasPage.jsx (não é compartilhada entre as duas telas de propósito,
// ver comentário sobre `parseSseEvent` em conversasApi.js: cada tela tem sua
// própria função isolada mesmo que pareça duplicação).
function formatRelativoNotificacao(iso) {
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

export default function ControleLigacoesShell() {
  const { isAdmin, token } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Destaca o botão "Configurações" quando a rota atual já é uma das
  // subrotas (Usuários/Números Remetentes) — decisão: isso NÃO abre mais o
  // flyout sozinho (diferente do antigo submenu vertical, que nascia
  // expandido nesse caso). Num flyout hover/click, auto-abrir ao navegar
  // ficaria estranho (o painel apareceria flutuando sem o usuário ter
  // pedido); em vez disso, só o item ativo dentro do flyout já se destaca
  // via `NavLink`/`aria-current` quando o usuário abrir o menu de novo, e o
  // próprio botão "Configurações" ganha um destaque sutil (mesmo estilo de
  // fundo do hover) enquanto uma dessas subrotas está ativa.
  const emSubrotaConfiguracoes =
    location.pathname.startsWith('/controle-ligacoes/usuarios') ||
    location.pathname.startsWith('/controle-ligacoes/configuracoes');

  const [configuracoesFlyoutAberto, setConfiguracoesFlyoutAberto] = useState(false);
  const configFlyoutRef = useRef(null);

  useEffect(() => {
    if (!configuracoesFlyoutAberto) return undefined;
    function handleClickOutside(e) {
      if (configFlyoutRef.current && !configFlyoutRef.current.contains(e.target)) {
        setConfiguracoesFlyoutAberto(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [configuracoesFlyoutAberto]);

  // Fecha o flyout quando o foco (via teclado) sai do container inteiro
  // (botão + painel) — sem isso, tabular entre os itens do submenu fecharia
  // o flyout a cada troca de foco, já que cada item é um elemento diferente.
  function handleConfiguracoesBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setConfiguracoesFlyoutAberto(false);
    }
  }

  function fecharConfiguracoesEMobile() {
    setConfiguracoesFlyoutAberto(false);
    setMobileOpen(false);
  }

  // --- sino de notificações (handoff IA→humano ainda não visto) ---
  const [notificacoesNaoVistas, setNotificacoesNaoVistas] = useState(0);
  // `null` = ainda não carregado (sentinela, distinto de "carregou e veio
  // vazio") — array (mesmo vazio) só depois que `refetchNotificacoes`
  // resolver com sucesso pelo menos uma vez. Ver estados no JSX do dropdown.
  const [notificacoesItens, setNotificacoesItens] = useState(null);
  const [notificacoesAberto, setNotificacoesAberto] = useState(false);
  const notificacoesRef = useRef(null);

  const refetchNotificacoes = useCallback(() => (
    fetchNotificacoes(token)
      .then((resposta) => {
        setNotificacoesNaoVistas(resposta?.naoVistas || 0);
        setNotificacoesItens(resposta?.itens || []);
      })
      .catch((err) => {
        // Contagem do sino não é crítica o bastante para exibir erro na UI —
        // só loga, mantém o valor atual.
        console.error('Erro ao buscar notificações do Controle de Ligações:', err);
      })
  ), [token]);

  useEffect(() => {
    refetchNotificacoes();
  }, [refetchNotificacoes]);

  useEffect(() => {
    if (!notificacoesAberto) return undefined;
    function handleClickOutside(e) {
      if (notificacoesRef.current && !notificacoesRef.current.contains(e.target)) {
        setNotificacoesAberto(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notificacoesAberto]);

  // Conexão SSE própria do shell (independente da que ConversasPage.jsx já
  // mantém) — precisa continuar contando mesmo fora da tela de Conversas.
  // Mesmo padrão de useEffect+AbortController+reconexão de ConversasPage.jsx.
  useEffect(() => {
    if (!token) return undefined;

    let montado = true;
    let controller = null;
    let reconnectTimer = null;

    function conectar() {
      controller = new AbortController();
      abrirStreamConversas(token, {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event !== 'nova-mensagem' || !data || data.primeiraResposta !== true) return;
          // Refetch completo (contagem + itens) em vez de só incrementar o
          // contador local — o backend é sempre a fonte de verdade (mesmo
          // princípio já documentado em ConversasPage.jsx). Um incremento
          // otimista aqui deixava o badge certo mas a lista do dropdown presa
          // no estado da montagem inicial, nunca refletindo a notificação
          // nova (bug de raiz corrigido).
          refetchNotificacoes();
        },
      }).catch((err) => {
        // `AbortController.abort()` (cleanup deste efeito) rejeita com
        // `AbortError` — não é uma queda real, não deve reconectar.
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
  }, [token, refetchNotificacoes]);

  function toggleNotificacoes() {
    setNotificacoesAberto((aberto) => !aberto);
  }

  // Clique num item do dropdown: fecha o painel e navega para Conversas já
  // pré-selecionando aquele contato (via `location.state` — ConversasPage.jsx
  // lê isso num efeito próprio, ver "Tarefa 2" do prompt). Não passamos pelo
  // fluxo normal de seleção (que depende da lista `conversas` já carregada)
  // porque o contato pode nem estar visível na lista ainda dependendo do
  // filtro de busca ativo naquela tela.
  function selecionarNotificacao(item) {
    setNotificacoesAberto(false);
    setMobileOpen(false);
    // `nome` dentro do `state` é um contrato interno com ConversasPage.jsx
    // (que lê `location.state.nome`) — não precisa bater com o nome do campo
    // vindo da API (`nomeContato`).
    navigate('/controle-ligacoes/conversas', {
      state: { contatoId: item.contatoId, nome: item.nomeContato, telefone: item.telefone },
    });
  }

  function verTodasAsConversas() {
    setNotificacoesAberto(false);
    setMobileOpen(false);
    navigate('/controle-ligacoes/conversas');
  }

  const badgeNotificacoes = notificacoesNaoVistas > 9 ? '9+' : String(notificacoesNaoVistas);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={mobileOpen}
        className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-xl text-[var(--text)] shadow-lg lg:hidden"
      >
        ☰
      </button>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      {/* `overflow-y-auto` fica só no <nav> abaixo, não mais no <aside>
          inteiro: o CSS Overflow spec força overflow-x a virar 'auto' (e
          portanto clipar) sempre que overflow-y não é 'visible', mesmo que
          overflow-x seja explicitamente 'visible' — o que cortaria o flyout
          de "Configurações" (posicionado com `left-full`, fora da largura
          do <aside>) bem na borda direita da sidebar. Como o bloco de
          "Configurações" mora fora de qualquer ancestral com overflow
          diferente de 'visible' agora, o flyout escapa livremente para a
          direita, sobre o conteúdo principal. */}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 flex-col border-r border-[var(--border)] bg-[var(--panel)] px-3 py-5 transition-transform duration-200 lg:w-56 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
          className="mb-4 flex h-11 w-11 items-center justify-center self-end rounded-lg text-xl text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)] lg:hidden"
        >
          ✕
        </button>

        <div className="mb-6 px-2">
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">NovaGest</div>
          <div className="font-display mt-0.5 text-xl font-extrabold leading-none text-[var(--text)]">Controle de Ligações</div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <NavLink to="/controle-ligacoes" end onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">🏠</span>
            Início
          </NavLink>
          <NavLink to="/controle-ligacoes/importacao" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">📥</span>
            Importação
          </NavLink>
          <NavLink to="/controle-ligacoes/conversas" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">💬</span>
            Conversas
          </NavLink>
          <NavLink to="/controle-ligacoes/painel-disparo" onClick={() => setMobileOpen(false)} className={navItemClass}>
            <span className="text-base leading-none">🚀</span>
            Painel de Disparo
          </NavLink>
        </nav>

        <div className="mt-auto flex flex-col gap-1">
          <div
            className="relative"
            ref={configFlyoutRef}
            onMouseEnter={() => setConfiguracoesFlyoutAberto(true)}
            onMouseLeave={() => setConfiguracoesFlyoutAberto(false)}
            onBlur={handleConfiguracoesBlur}
          >
            <button
              type="button"
              // Abre (nunca fecha) no clique — não alterna: um clique de
              // mouse "de verdade" já passa por `mouseenter` antes do
              // `click` (o próprio userEvent.click dos testes simula isso),
              // então um toggle aqui fecharia o flyout que o hover acabou
              // de abrir um instante antes. Fechar continua sendo
              // responsabilidade do `mouseleave`/clique fora/seleção de item.
              onClick={() => setConfiguracoesFlyoutAberto(true)}
              onFocus={() => setConfiguracoesFlyoutAberto(true)}
              aria-expanded={configuracoesFlyoutAberto}
              aria-haspopup="true"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                emSubrotaConfiguracoes || configuracoesFlyoutAberto
                  ? 'bg-[var(--panel-alt)] text-[var(--text)]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
              }`}
            >
              <span className="text-base leading-none">⚙️</span>
              <span className="flex-1 text-left">Configurações</span>
              <span className="text-sm leading-none">▸</span>
            </button>

            {configuracoesFlyoutAberto ? (
              <div className="absolute bottom-0 left-full z-50 ml-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-1 shadow-lg">
                {isAdmin ? (
                  <NavLink to="/controle-ligacoes/usuarios" onClick={fecharConfiguracoesEMobile} className={flyoutItemClass}>
                    <span className="text-sm leading-none">👥</span>
                    Usuários
                  </NavLink>
                ) : null}
                <NavLink
                  to="/controle-ligacoes/configuracoes/numeros-remetentes"
                  onClick={fecharConfiguracoesEMobile}
                  className={flyoutItemClass}
                >
                  <span className="text-sm leading-none">📱</span>
                  Números Remetentes
                </NavLink>
              </div>
            ) : null}
          </div>
          <UserFooterMenu />
        </div>
      </aside>

      {/* Sino de notificações: posicionado `fixed` no canto superior direito
          da VIEWPORT (não da sidebar) — como cada página do módulo renderiza
          seu próprio cabeçalho, este é o jeito mais direto de deixá-lo
          sempre visível no canto oposto ao menu principal, em qualquer tela
          do Controle de Ligações, sem precisar tocar em cada página. Mesmo
          princípio do botão hambúrguer mobile logo no topo deste arquivo
          (`fixed left-3 top-3 z-50 ... lg:hidden`), mas visível em todos os
          tamanhos de tela (não só mobile) e no canto oposto. */}
      <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-5" ref={notificacoesRef}>
        <button
          type="button"
          onClick={toggleNotificacoes}
          aria-label={
            notificacoesNaoVistas > 0
              ? `Notificações: ${notificacoesNaoVistas} conversa(s) não vista(s)`
              : 'Notificações'
          }
          aria-expanded={notificacoesAberto}
          aria-haspopup="true"
          className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel)] text-lg text-[var(--muted)] shadow-lg transition-colors hover:bg-[var(--panel-alt)] hover:text-[var(--text)]"
        >
          🔔
          {notificacoesNaoVistas > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold leading-none text-white">
              {badgeNotificacoes}
            </span>
          ) : null}
        </button>

        {notificacoesAberto ? (
          <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--border)] bg-[var(--panel-alt)] p-1 shadow-lg">
            {notificacoesItens === null ? (
              <div className="px-3 py-4 text-center text-[12.5px] text-[var(--muted)]">
                Carregando...
              </div>
            ) : notificacoesItens.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12.5px] text-[var(--muted)]">
                Nenhuma notificação.
              </div>
            ) : (
              <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {notificacoesItens.map((item) => (
                  <li key={item.contatoId}>
                    <button
                      type="button"
                      onClick={() => selecionarNotificacao(item)}
                      className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--panel)]"
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-[var(--text)]">{item.nomeContato}</span>
                        <span className="shrink-0 text-[10.5px] text-[var(--muted)]">{formatRelativoNotificacao(item.criado_em)}</span>
                      </div>
                      <span className="w-full truncate text-[12px] text-[var(--muted)]">{item.preview}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-[var(--border)] p-1">
              <button
                type="button"
                onClick={verTodasAsConversas}
                className="block w-full rounded-md px-3 py-2 text-center text-[12px] font-semibold text-[var(--violet)] transition-colors hover:bg-[var(--panel)]"
              >
                Ver todas as conversas
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <main className="min-h-screen lg:ml-56">
        <Outlet context={{ refetchNotificacoes }} />
      </main>
    </div>
  );
}
