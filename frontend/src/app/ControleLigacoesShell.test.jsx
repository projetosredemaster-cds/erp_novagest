// style-system: Tailwind
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ControleLigacoesShell from './ControleLigacoesShell.jsx';

vi.mock('./AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../modulos/controle-ligacoes/conversas/conversasApi.js', () => ({
  fetchNotificacoes: vi.fn(),
  abrirStreamConversas: vi.fn(),
}));

import { useAuth } from './AuthContext.jsx';
import * as conversasApi from '../modulos/controle-ligacoes/conversas/conversasApi.js';

function ConversasRouteProbe() {
  const location = useLocation();
  return (
    <div>
      Conversas (rota de teste)
      {location.state?.contatoId ? (
        <div data-testid="state-recebido">
          {location.state.contatoId}|{location.state.nome}|{location.state.telefone}
        </div>
      ) : null}
    </div>
  );
}

function renderShell(initialEntries = ['/controle-ligacoes']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/controle-ligacoes" element={<ControleLigacoesShell />}>
          <Route index element={<div>Início (rota de teste)</div>} />
          <Route path="conversas" element={<ConversasRouteProbe />} />
          <Route path="usuarios" element={<div>Usuários (rota de teste)</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function notificacaoItem(overrides = {}) {
  return {
    contatoId: 42,
    nomeContato: 'Maria Silva',
    telefone: '5598900000000',
    preview: 'Oi, ainda estão com a promoção?',
    criado_em: '2026-08-25T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: false, token: 'token-teste' });
  conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 0, itens: [] });
  conversasApi.abrirStreamConversas.mockImplementation(() => new Promise(() => {}));
});

describe('ControleLigacoesShell - flyout de Configurações', () => {
  it('nasce fechado e, sem admin, o flyout mostra só "Números Remetentes" ao clicar em Configurações', async () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: false });

    renderShell();

    const botaoConfiguracoes = screen.getByRole('button', { name: /configurações/i });
    expect(botaoConfiguracoes).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /números remetentes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument();

    await userEvent.click(botaoConfiguracoes);

    expect(botaoConfiguracoes).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /números remetentes/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument();
  });

  it('com admin, ao clicar em Configurações o flyout mostra os dois subitens (Usuários e Números Remetentes)', async () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell();

    const botaoConfiguracoes = screen.getByRole('button', { name: /configurações/i });
    await userEvent.click(botaoConfiguracoes);

    const linkUsuarios = screen.getByRole('link', { name: /usuários/i });
    expect(linkUsuarios).toBeInTheDocument();
    expect(linkUsuarios).toHaveAttribute('href', '/controle-ligacoes/usuarios');

    const linkNumeros = screen.getByRole('link', { name: /números remetentes/i });
    expect(linkNumeros).toBeInTheDocument();
    expect(linkNumeros).toHaveAttribute('href', '/controle-ligacoes/configuracoes/numeros-remetentes');
  });

  it('abre também no hover (mouseEnter) e fecha no mouseLeave', () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell();

    const botaoConfiguracoes = screen.getByRole('button', { name: /configurações/i });
    const container = botaoConfiguracoes.parentElement;

    fireEvent.mouseEnter(container);
    expect(screen.getByRole('link', { name: /números remetentes/i })).toBeInTheDocument();

    fireEvent.mouseLeave(container);
    expect(screen.queryByRole('link', { name: /números remetentes/i })).not.toBeInTheDocument();
  });

  it('clicar fora do flyout aberto fecha o menu', async () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell();

    const botaoConfiguracoes = screen.getByRole('button', { name: /configurações/i });
    await userEvent.click(botaoConfiguracoes);
    expect(screen.getByRole('link', { name: /usuários/i })).toBeInTheDocument();

    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument());
  });

  it('selecionar um item do flyout fecha o menu e navega para a subrota', async () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell();

    await userEvent.click(screen.getByRole('button', { name: /configurações/i }));
    await userEvent.click(screen.getByRole('link', { name: /usuários/i }));

    expect(await screen.findByText('Usuários (rota de teste)')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument();
  });

  it('destaca o botão "Configurações" quando a rota atual já é uma subrota, mas não abre o flyout sozinho', () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell(['/controle-ligacoes/usuarios']);

    const botaoConfiguracoes = screen.getByRole('button', { name: /configurações/i });

    expect(botaoConfiguracoes).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument();
  });

  it('não mostra mais o link "Usuários" solto fora do flyout de Configurações', () => {
    useAuth.mockReturnValue({ logout: vi.fn(), isAdmin: true });

    renderShell();

    expect(screen.queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument();
  });
});

describe('ControleLigacoesShell - sino de notificações', () => {
  it('busca a contagem inicial ao montar e exibe o badge', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 3, itens: [] });

    renderShell();

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(conversasApi.fetchNotificacoes).toHaveBeenCalledWith('token-teste');
  });

  it('não mostra badge quando a contagem inicial é zero', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 0, itens: [] });

    renderShell();

    await waitFor(() => expect(conversasApi.fetchNotificacoes).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });

  it('mostra "9+" quando a contagem inicial é 10 ou mais', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 12, itens: [] });

    renderShell();

    expect(await screen.findByText('9+')).toBeInTheDocument();
  });

  it('evento SSE com primeiraResposta:true dispara um refetch completo (contador e lista atualizados pelo backend)', async () => {
    conversasApi.fetchNotificacoes
      .mockResolvedValueOnce({ naoVistas: 1, itens: [] })
      .mockResolvedValueOnce({ naoVistas: 2, itens: [notificacaoItem()] });
    let onEvent;
    conversasApi.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    renderShell();

    await screen.findByText('1');
    expect(conversasApi.fetchNotificacoes).toHaveBeenCalledTimes(1);

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3, primeiraResposta: true });

    await waitFor(() => expect(conversasApi.fetchNotificacoes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /notificações/i }));
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
  });

  it('evento SSE com primeiraResposta ausente/false é ignorado pelo sino (sem refetch)', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 1, itens: [] });
    let onEvent;
    conversasApi.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    renderShell();

    await screen.findByText('1');
    expect(conversasApi.fetchNotificacoes).toHaveBeenCalledTimes(1);

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3, primeiraResposta: false });

    await waitFor(() => expect(conversasApi.abrirStreamConversas).toHaveBeenCalledTimes(1));
    expect(conversasApi.fetchNotificacoes).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('o sino fica fixo no canto superior direito da tela, fora da sidebar', async () => {
    renderShell();

    const botaoSino = await screen.findByRole('button', { name: /notificações/i });

    expect(botaoSino.parentElement).toHaveClass('fixed', 'right-4', 'top-4');

    const titulo = screen.getByText('NovaGest');

    expect(botaoSino.closest('aside')).toBeNull();
    expect(titulo.closest('aside')).not.toBeNull();
  });

  it('clicar no sino NÃO navega mais direto — abre um dropdown inline com as notificações', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({
      naoVistas: 1,
      itens: [notificacaoItem()],
    });

    renderShell();

    const botaoSino = await screen.findByRole('button', { name: /notificações/i });
    await userEvent.click(botaoSino);

    expect(screen.getByText('Início (rota de teste)')).toBeInTheDocument();
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('Oi, ainda estão com a promoção?')).toBeInTheDocument();
  });

  it('dropdown vazio (itens: []) mostra "Nenhuma notificação."', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({ naoVistas: 0, itens: [] });

    renderShell();

    const botaoSino = await screen.findByRole('button', { name: 'Notificações' });
    await userEvent.click(botaoSino);

    expect(screen.getByText('Nenhuma notificação.')).toBeInTheDocument();
  });

  it('antes do primeiro fetch resolver, o dropdown mostra "Carregando..." em vez de "Nenhuma notificação."', async () => {
    let resolveFetch;
    conversasApi.fetchNotificacoes.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    renderShell();

    const botaoSino = screen.getByRole('button', { name: 'Notificações' });
    await userEvent.click(botaoSino);

    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma notificação.')).not.toBeInTheDocument();

    resolveFetch({ naoVistas: 0, itens: [] });

    await waitFor(() => expect(screen.getByText('Nenhuma notificação.')).toBeInTheDocument());
  });

  it('clicar num item do dropdown navega para Conversas com o contato pré-selecionado no state', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({
      naoVistas: 1,
      itens: [notificacaoItem()],
    });

    renderShell();

    const botaoSino = await screen.findByRole('button', { name: /notificações/i });
    await userEvent.click(botaoSino);
    await userEvent.click(screen.getByText('Maria Silva'));

    expect(await screen.findByText('Conversas (rota de teste)')).toBeInTheDocument();
    expect(await screen.findByTestId('state-recebido')).toHaveTextContent('42|Maria Silva|5598900000000');
    expect(screen.queryByText('Oi, ainda estão com a promoção?')).not.toBeInTheDocument();
  });

  it('"Ver todas as conversas" navega para Conversas sem nenhum contato pré-selecionado', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({
      naoVistas: 1,
      itens: [notificacaoItem()],
    });

    renderShell();

    const botaoSino = await screen.findByRole('button', { name: /notificações/i });
    await userEvent.click(botaoSino);
    await userEvent.click(screen.getByRole('button', { name: 'Ver todas as conversas' }));

    expect(await screen.findByText('Conversas (rota de teste)')).toBeInTheDocument();
    expect(screen.queryByTestId('state-recebido')).not.toBeInTheDocument();
  });

  it('clicar fora do dropdown aberto fecha o menu', async () => {
    conversasApi.fetchNotificacoes.mockResolvedValue({
      naoVistas: 1,
      itens: [notificacaoItem()],
    });

    renderShell();

    const botaoSino = await screen.findByRole('button', { name: /notificações/i });
    await userEvent.click(botaoSino);
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();

    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByText('Maria Silva')).not.toBeInTheDocument());
  });
});
