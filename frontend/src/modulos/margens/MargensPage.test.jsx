// Testes de componente (Vitest + React Testing Library) de MargensPage.jsx
// (ver CONTRATO-MARGENS-API.md v4). `margensApi.js` e
// `../../lib/cadastrosApi.js` (de onde MargensPage importa `fetchRedes`)
// continuam totalmente mockados — nenhuma chamada de rede real acontece
// aqui, mesmo padrão de RankingPage.test.jsx.
//
// Cobre:
//  - estados de loading/erro/vazio do bloco "Lançamento por loja";
//  - confirmar uma loja pela primeira vez: chama salvarEntrada com os
//    valores certos (consolidado + totalTar digitado) e, após sucesso, os
//    campos ficam desabilitados com o selo "Confirmado";
//  - clicar "Editar" reabilita os campos de uma loja já confirmada;
//  - filtros (Rede/Cor/Loja) da tela de Relatório filtram em memória sem
//    disparar nova chamada de API (fetchRelatorio não é chamado de novo).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MargensPage from './MargensPage.jsx';

vi.mock('./margensApi', () => ({
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
  fetchRelatorio: vi.fn(),
}));

vi.mock('../../lib/cadastrosApi.js', () => ({
  fetchRedes: vi.fn(),
}));

import * as margensApi from './margensApi';
import { fetchRedes } from '../../lib/cadastrosApi.js';

function diretorComRede({ redeId = 5, redeNome = 'Delta', lojas } = {}) {
  return {
    diretor: { id: 1, nome: 'Victor Hugo' },
    id: redeId,
    nome: redeNome,
    responsavel: null,
    lojas: lojas || [{ id: 40, nome: 'Loja Teste', ativo: true }],
  };
}

// mocks-padrão pra qualquer teste que só precisa que a página carregue sem
// travar (não é o foco do teste em si).
function mockCargaBasica({ redes, entradas, relatorio } = {}) {
  fetchRedes.mockResolvedValue(redes ?? [diretorComRede()]);
  margensApi.fetchEntradas.mockResolvedValue(entradas ?? []);
  margensApi.fetchRelatorio.mockResolvedValue(relatorio ?? []);
}

async function renderPage() {
  const utils = render(<MargensPage />);
  await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText('Carregando resumo...')).not.toBeInTheDocument());
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MargensPage — Lançamento por loja: estados de loading/erro/vazio', () => {
  it('loading: mostra "Carregando..." enquanto as promises não resolvem', async () => {
    fetchRedes.mockReturnValue(new Promise(() => {})); // nunca resolve
    margensApi.fetchEntradas.mockReturnValue(new Promise(() => {}));
    margensApi.fetchRelatorio.mockReturnValue(new Promise(() => {}));

    render(<MargensPage />);

    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
  });

  it('erro: fetchRedes rejeitado mostra a mensagem de erro e botão "Tentar novamente"', async () => {
    fetchRedes.mockRejectedValue(new Error('Falha ao buscar redes'));
    margensApi.fetchEntradas.mockResolvedValue([]);
    margensApi.fetchRelatorio.mockResolvedValue([]);

    render(<MargensPage />);

    expect(await screen.findByText(/Não foi possível carregar diretores\/redes: Falha ao buscar redes/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('vazio: nenhuma rede cadastrada mostra a mensagem de estado vazio', async () => {
    mockCargaBasica({ redes: [] });

    await renderPage();

    expect(screen.getByText('Nenhuma rede cadastrada ainda. Cadastre diretores, redes e lojas para começar a lançar margem.'))
      .toBeInTheDocument();
  });
});

describe('MargensPage — confirmar lançamento de uma loja', () => {
  it('primeira confirmação: chama salvarEntrada com data/lojaId/faturamento/custoProduto/totalTar corretos e, após sucesso, desabilita os campos com o selo "Confirmado"', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    await renderPage();

    // seleciona a rede pra revelar as lojas
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    // preenche o consolidado da franquia
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '10000000' } }); // 100.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '4000000' } }); // 40.000,00

    // preenche o Total Tar da loja
    fireEvent.change(screen.getByLabelText('Total Tar'), { target: { value: '500000' } }); // 5.000,00

    const botaoConfirmar = screen.getByRole('button', { name: 'Confirmar' });
    expect(botaoConfirmar).not.toBeDisabled();
    fireEvent.click(botaoConfirmar);

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 100000,
      custoProduto: 40000,
      totalTar: 5000,
    }));

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByLabelText('Total Tar')).toBeDisabled();
  });

  it('botão "Confirmar" fica desabilitado enquanto o Total Tar não foi digitado', async () => {
    mockCargaBasica();

    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });
});

describe('MargensPage — editar uma loja já confirmada', () => {
  it('clicar "Editar" reabilita os campos da loja', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    // já chega bloqueada (confirmada) porque já existe entrada pra essa loja/data
    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByLabelText('Total Tar')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.queryByText('✓ Confirmado')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Total Tar')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
  });
});

describe('MargensPage — filtros da tela de Relatório', () => {
  function blocosRelatorio() {
    return [
      {
        diretor: { id: 1, nome: 'Diretor A' },
        rede: { id: 10, nome: 'Rede Delta', responsavel: null },
        lojas: [{ id: 100, nome: 'Loja Verde', faturamento: 1000, custoProduto: 400, totalTar: 100, lucro: 500, percentualMargem: 50, cor: 'verde' }],
      },
      {
        diretor: { id: 1, nome: 'Diretor A' },
        rede: { id: 11, nome: 'Rede Lendarios', responsavel: null },
        lojas: [{ id: 101, nome: 'Loja Vermelha', faturamento: 1000, custoProduto: 900, totalTar: 50, lucro: 50, percentualMargem: 5, cor: 'vermelho' }],
      },
    ];
  }

  async function irParaRelatorio() {
    mockCargaBasica({ relatorio: blocosRelatorio() });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '📊 Ver relatório de período' }));

    // RelatorioView dispara fetchRelatorio de novo ao montar
    await waitFor(() => expect(screen.queryByText('Gerando relatório...')).not.toBeInTheDocument());
    expect(await screen.findByText('Loja Verde')).toBeInTheDocument();
    expect(await screen.findByText('Loja Vermelha')).toBeInTheDocument();
  }

  it('filtrar por Cor não dispara nova chamada de fetchRelatorio', async () => {
    await irParaRelatorio();

    const chamadasAntes = margensApi.fetchRelatorio.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Cor'), { target: { value: 'vermelho' } });

    expect(screen.queryByText('Loja Verde')).not.toBeInTheDocument();
    expect(screen.getByText('Loja Vermelha')).toBeInTheDocument();
    expect(margensApi.fetchRelatorio.mock.calls.length).toBe(chamadasAntes);
  });

  it('filtrar por Rede não dispara nova chamada de fetchRelatorio', async () => {
    await irParaRelatorio();

    const chamadasAntes = margensApi.fetchRelatorio.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '10' } });

    expect(screen.getByText('Loja Verde')).toBeInTheDocument();
    expect(screen.queryByText('Loja Vermelha')).not.toBeInTheDocument();
    expect(margensApi.fetchRelatorio.mock.calls.length).toBe(chamadasAntes);
  });

  it('filtrar por busca de loja não dispara nova chamada de fetchRelatorio', async () => {
    await irParaRelatorio();

    const chamadasAntes = margensApi.fetchRelatorio.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Buscar loja'), { target: { value: 'Verde' } });

    expect(screen.getByText('Loja Verde')).toBeInTheDocument();
    expect(screen.queryByText('Loja Vermelha')).not.toBeInTheDocument();
    expect(margensApi.fetchRelatorio.mock.calls.length).toBe(chamadasAntes);
  });
});
