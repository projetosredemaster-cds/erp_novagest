// style-system: Tailwind
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import UserFooterMenu from './UserFooterMenu.jsx';
import { fetchNotificacoes, abrirStreamConversas } from '../modulos/controle-ligacoes/conversas/conversasApi.js';

const RECONEXAO_SSE_MS = 5000;

const navItemClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
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

export default function ControleLigacoesShell() {
  const { isAdmin, token } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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

      {}
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
