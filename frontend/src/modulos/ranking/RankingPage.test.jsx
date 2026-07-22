// Testes de componente (Vitest + React Testing Library) da feature "ocultar
// rede" em RankingPage.jsx. `rankingApi.js` e `AuthContext.jsx` são
// totalmente mockados — nenhuma chamada de rede real acontece aqui.
//
// Cobre:
//  - uma rede com visivel:false não aparece no grid principal (nó ausente
//    do DOM, não escondido via CSS);
//  - "Gerar relatório do dia" não inclui o nome da rede oculta;
//  - isAdmin:false esconde o botão Ocultar/Mostrar em todos os lugares;
//  - isAdmin:true: clicar em "Ocultar" chama atualizarRede com
//    { visivel: false } e só atualiza o estado local após a promise
//    resolver; se a promise rejeitar, o estado local não muda e o flash de
//    erro aparece.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RankingPage from './RankingPage.jsx';

vi.mock('./rankingApi', () => ({
  fetchRedes: vi.fn(),
  fetchCategorias: vi.fn(),
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
  criarRede: vi.fn(),
  atualizarRede: vi.fn(),
  removerRede: vi.fn(),
  criarLoja: vi.fn(),
  removerLoja: vi.fn(),
  enviarRelatorioPorEmail: vi.fn(),
}));

vi.mock('../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as rankingApi from './rankingApi';
import { useAuth } from '../../app/AuthContext.jsx';

const CATEGORIA_PRINCIPAL = { id: 1, nome: 'Vendas', principal: true };

function redeVisivel() {
  return {
    id: 10,
    nome: 'Rede Visível',
    responsavel: 'Ana',
    visivel: true,
    lojas: [{ id: 100, nome: 'Loja A', emoji: '🏆' }],
  };
}

function redeOculta() {
  return {
    id: 20,
    nome: 'Rede Oculta',
    responsavel: 'Bia',
    visivel: false,
    lojas: [{ id: 200, nome: 'Loja B', emoji: '🥈' }],
  };
}

function mockDadosIniciais({ redes }) {
  rankingApi.fetchRedes.mockResolvedValue(redes);
  rankingApi.fetchCategorias.mockResolvedValue([CATEGORIA_PRINCIPAL]);
  rankingApi.fetchEntradas.mockResolvedValue([
    { loja_id: 100, valor: 50 },
  ]);
}

async function renderPage() {
  const utils = render(<RankingPage />);
  // espera a tela sair do estado "Carregando..." inicial
  await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RankingPage — ocultar rede (grid principal)', () => {
  it('uma rede com visivel:false não tem nenhum nó no grid principal; a rede visível aparece normalmente', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    await renderPage();

    expect(await screen.findByText('Rede Visível')).toBeInTheDocument();
    expect(screen.queryByText('Rede Oculta')).not.toBeInTheDocument();
    expect(screen.queryByText('Loja B')).not.toBeInTheDocument();
  });

  it('"Gerar relatório do dia" não inclui o nome da rede oculta', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar relatório do dia' }));

    const textarea = screen.getByPlaceholderText(/Clique em "Gerar relatório do dia"/);
    expect(textarea.value).toContain('Rede Visível');
    expect(textarea.value).not.toContain('Rede Oculta');
  });
});

describe('RankingPage — controle de admin do botão Ocultar/Mostrar', () => {
  it('isAdmin:false — o botão Ocultar não aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();

    expect(await screen.findByText('Rede Visível')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    // a ConfigView também não é acessível: sem o botão de navegação para admin
    expect(screen.queryByRole('button', { name: /Configurar redes\/lojas/ })).not.toBeInTheDocument();
  });

  it('isAdmin:true — o botão Ocultar aparece no card do grid principal', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    await renderPage();

    expect(await screen.findByText('Rede Visível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();
  });
});

describe('RankingPage — toggleRedeVisivel (clique em Ocultar, isAdmin:true)', () => {
  it('clicar em "Ocultar" chama atualizarRede com { visivel: false } e só atualiza o estado local após a promise resolver', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });

    let resolvePromise;
    rankingApi.atualizarRede.mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; })
    );

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(10, { visivel: false });
    // ainda não resolveu: a rede continua visível no grid
    expect(screen.getByText('Rede Visível')).toBeInTheDocument();

    resolvePromise({ ...redeVisivel(), visivel: false });

    await waitFor(() => expect(screen.queryByText('Rede Visível')).not.toBeInTheDocument());
  });

  it('se a promise rejeitar, o estado local NÃO muda e o flash de erro aparece', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel()] });
    rankingApi.atualizarRede.mockRejectedValue(new Error('Falha simulada ao atualizar rede'));

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Ocultar' }));

    await waitFor(() => expect(screen.getByText('Falha simulada ao atualizar rede')).toBeInTheDocument());
    // a rede continua visível no grid — estado local não mudou
    expect(screen.getByText('Rede Visível')).toBeInTheDocument();
  });
});

describe('RankingPage — ConfigView (tela "⚙ Configurar redes/lojas")', () => {
  it('isAdmin:true — rede oculta mostra o texto "(oculta do relatório)" e o botão "Mostrar"; clicar chama atualizarRede com { visivel: true }', async () => {
    useAuth.mockReturnValue({ isAdmin: true });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });
    rankingApi.atualizarRede.mockResolvedValue({ ...redeOculta(), visivel: true });

    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('button', { name: /Configurar redes\/lojas/ }));

    expect(screen.getByText('(oculta do relatório)')).toBeInTheDocument();
    const mostrarBtn = screen.getByRole('button', { name: 'Mostrar' });
    expect(mostrarBtn).toBeInTheDocument();
    // a rede visível, na mesma tela, mostra "Ocultar" (não "Mostrar")
    expect(screen.getByRole('button', { name: 'Ocultar' })).toBeInTheDocument();

    await user.click(mostrarBtn);

    expect(rankingApi.atualizarRede).toHaveBeenCalledWith(20, { visivel: true });
  });

  it('isAdmin:false — a ConfigView não é acessível (sem botão de navegação) e nenhum botão Ocultar/Mostrar existe em nenhum lugar', async () => {
    useAuth.mockReturnValue({ isAdmin: false });
    mockDadosIniciais({ redes: [redeVisivel(), redeOculta()] });

    await renderPage();

    expect(screen.queryByRole('button', { name: /Configurar redes\/lojas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mostrar' })).not.toBeInTheDocument();
  });
});
