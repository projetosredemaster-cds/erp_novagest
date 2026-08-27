// style-system: Tailwind
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import UserFooterMenu from './UserFooterMenu.jsx';
import { fetchNotificacoes, abrirStreamConversas } from '../modulos/controle-ligacoes/conversas/conversasApi.js';

const RECONEXAO_SSE_MS = 5000;
const SIDEBAR_COLAPSADA_STORAGE_KEY = 'controleLigacoes.sidebarColapsada';

function lerSidebarColapsadaInicial() {
  try {
    const valor = localStorage.getItem(SIDEBAR_COLAPSADA_STORAGE_KEY);
    if (valor === null) return true;
    return valor === 'true';
  } catch {
    return true;
  }
}

const navItemClass = (colapsada) => ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
    colapsada ? 'lg:justify-center lg:px-0' : ''
  } ${
    isActive
      ? 'bg-[var(--violet)] text-[#0b1010]'
      : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
  }`;

const flyoutItemClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? 'bg-[var(--violet)] text-[#0b1010]'
      : 'text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]'
  }`;

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

function IconLayoutGrid({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function IconRocket({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

function IconMessageCircle({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function IconKanbanSquare({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M8 7v7" />
      <path d="M12 7v4" />
      <path d="M16 7v9" />
    </svg>
  );
}

function IconSettings({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconBell({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  );
}

function IconUpload({ size = 20, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tocarTom = (freq, inicio, duracao) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + inicio + duracao);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + duracao);
    };
    tocarTom(880, 0, 0.12);
    tocarTom(1175, 0.1, 0.15);
  } catch (err) {
    void err;
  }
}

export default function ControleLigacoesShell() {
  const { isAdmin, token } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarColapsada, setSidebarColapsada] = useState(lerSidebarColapsadaInicial);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLAPSADA_STORAGE_KEY, String(sidebarColapsada));
    } catch {
      /* empty */
    }
  }, [sidebarColapsada]);

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

  function handleConfiguracoesBlur(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setConfiguracoesFlyoutAberto(false);
    }
  }

  function fecharConfiguracoesEMobile() {
    setConfiguracoesFlyoutAberto(false);
    setMobileOpen(false);
  }

  const [notificacoesNaoVistas, setNotificacoesNaoVistas] = useState(0);
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
          refetchNotificacoes();
          tocarSomNotificacao();
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
  }, [token, refetchNotificacoes]);

  function toggleNotificacoes() {
    setNotificacoesAberto((aberto) => !aberto);
  }

  function selecionarNotificacao(item) {
    setNotificacoesAberto(false);
    setMobileOpen(false);

    navigate('/controle-ligacoes/conversas', {
      state: {
        contatoId: item.contatoId,
        numeroRemetenteId: item.numeroRemetenteId,
        nome: item.nomeContato,
        telefone: item.telefone,
      },
    });
  }

  function verTodasAsConversas() {
    setNotificacoesAberto(false);
    setMobileOpen(false);
    navigate('/controle-ligacoes/conversas');
  }

  const badgeNotificacoes = notificacoesNaoVistas > 9 ? '9+' : String(notificacoesNaoVistas);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] cl-figtree">
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

      {}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-72 flex-col border-r border-[var(--border)] bg-[var(--panel)] px-3 py-5 transition-transform duration-200 lg:translate-x-0 ${
          sidebarColapsada ? 'lg:w-16' : 'lg:w-56'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          type="button"
          onClick={() => setSidebarColapsada((colapsada) => !colapsada)}
          aria-label={sidebarColapsada ? 'Expandir menu' : 'Recolher menu'}
          className="absolute -right-3 top-1/2 z-50 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--muted)] hover:text-[var(--text)] lg:flex"
        >
          {sidebarColapsada ? '›' : '‹'}
        </button>

        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
          className="mb-4 flex h-11 w-11 items-center justify-center self-end rounded-lg text-xl text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)] lg:hidden"
        >
          ✕
        </button>

        <div className={`mb-6 px-2 ${sidebarColapsada ? 'lg:hidden' : ''}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[.14em] text-[var(--violet)]">NovaGest</div>
          <div className="font-display mt-0.5 text-xl font-extrabold leading-none text-[var(--text)]">Controle de Ligações</div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1">
          <div className="group relative">
            <NavLink to="/controle-ligacoes" end onClick={() => setMobileOpen(false)} className={navItemClass(sidebarColapsada)}>
              <IconLayoutGrid size={20} className="shrink-0" />
              <span className={sidebarColapsada ? 'lg:hidden' : ''}>Início</span>
            </NavLink>
            {sidebarColapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block z-50">
                Início
              </span>
            ) : null}
          </div>
          <div className="group relative">
            <NavLink to="/controle-ligacoes/painel-disparo" onClick={() => setMobileOpen(false)} className={navItemClass(sidebarColapsada)}>
              <IconRocket size={20} className="shrink-0" />
              <span className={sidebarColapsada ? 'lg:hidden' : ''}>Painel de Disparo</span>
            </NavLink>
            {sidebarColapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block z-50">
                Painel de Disparo
              </span>
            ) : null}
          </div>
          <div className="group relative">
            <NavLink to="/controle-ligacoes/conversas" onClick={() => setMobileOpen(false)} className={navItemClass(sidebarColapsada)}>
              <IconMessageCircle size={20} className="shrink-0" />
              <span className={sidebarColapsada ? 'lg:hidden' : ''}>Conversas</span>
            </NavLink>
            {sidebarColapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block z-50">
                Conversas
              </span>
            ) : null}
          </div>
          <div className="group relative">
            <NavLink to="/controle-ligacoes/pipeline" onClick={() => setMobileOpen(false)} className={navItemClass(sidebarColapsada)}>
              <IconKanbanSquare size={20} className="shrink-0" />
              <span className={sidebarColapsada ? 'lg:hidden' : ''}>Pipeline</span>
            </NavLink>
            {sidebarColapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block z-50">
                Pipeline
              </span>
            ) : null}
          </div>
          <div className="group relative">
            <NavLink to="/controle-ligacoes/importacao" onClick={() => setMobileOpen(false)} className={navItemClass(sidebarColapsada)}>
              <IconUpload size={20} className="shrink-0" />
              <span className={sidebarColapsada ? 'lg:hidden' : ''}>Importação</span>
            </NavLink>
            {sidebarColapsada ? (
              <span className="pointer-events-none absolute left-full top-1/2 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block z-50">
                Importação
              </span>
            ) : null}
          </div>
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
              onClick={() => setConfiguracoesFlyoutAberto(true)}
              onFocus={() => setConfiguracoesFlyoutAberto(true)}
              aria-expanded={configuracoesFlyoutAberto}
              aria-haspopup="true"
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                sidebarColapsada ? 'lg:justify-center lg:px-0' : ''
              } ${
                emSubrotaConfiguracoes || configuracoesFlyoutAberto
                  ? 'bg-[var(--panel-alt)] text-[var(--text)]'
                  : 'text-[var(--muted)] hover:bg-[var(--panel-alt)] hover:text-[var(--text)]'
              }`}
            >
              <IconSettings size={20} className="shrink-0" />
              <span className={`flex-1 text-left ${sidebarColapsada ? 'lg:hidden' : ''}`}>Configurações</span>
              <span className={`text-sm leading-none ${sidebarColapsada ? 'lg:hidden' : ''}`}>▸</span>
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
          <UserFooterMenu colapsada={sidebarColapsada} />
        </div>
      </aside>

      {}
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
          <IconBell size={20} />
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

      <main className={`min-h-screen ${sidebarColapsada ? 'lg:ml-16' : 'lg:ml-56'}`}>
        <Outlet context={{ refetchNotificacoes }} />
      </main>
    </div>
  );
}
