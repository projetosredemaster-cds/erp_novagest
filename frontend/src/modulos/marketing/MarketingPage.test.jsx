import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketingPage from './MarketingPage.jsx';

vi.mock('./marketingApi', () => ({
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
  removerEntrada: vi.fn(),
}));

import * as marketingApi from './marketingApi';

function bloco({ diretorId = 1, diretorNome = 'Victor Hugo', redeId = 5, redeNome = 'Delta', lojas }) {
  return {
    diretor: { id: diretorId, nome: diretorNome },
    rede: { id: redeId, nome: redeNome },
    lojas: lojas || [],
  };
}

function lojaSemLancamento({ id = 40, nome = 'SLZ 01' } = {}) {
  return {
    id,
    nome,
    faturamentoGeral: null,
    faturamentoMarketing: null,
    faturamentoRetornoIndicacao: null,
    percentualMarketing: null,
    percentualRetornoIndicacao: null,
    comparacao: null,
    atualizadoEm: null,
  };
}

function lojaComLancamento({
  id = 41,
  nome = 'SLZ 02',
  faturamentoGeral = 1000,
  faturamentoMarketing = 200,
  faturamentoRetornoIndicacao = 50,
} = {}) {
  return {
    id,
    nome,
    faturamentoGeral,
    faturamentoMarketing,
    faturamentoRetornoIndicacao,
    percentualMarketing: (faturamentoMarketing / faturamentoGeral) * 100,
    percentualRetornoIndicacao: (faturamentoRetornoIndicacao / faturamentoGeral) * 100,
    comparacao: null,
    atualizadoEm: '2026-08-05T14:00:00.000Z',
  };
}

async function renderESelecionarDiretor(diretorId = 1) {
  render(<MarketingPage />);
  await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  const select = screen.getByRole('combobox', { name: 'Diretor' });
  await userEvent.selectOptions(select, String(diretorId));
}

beforeEach(() => {
  vi.clearAllMocks();
  marketingApi.salvarEntrada.mockResolvedValue({ atualizadoEm: '2026-08-18T12:00:00.000Z' });
  marketingApi.removerEntrada.mockResolvedValue(undefined);
});

describe('MarketingPage — onBlur só salva quando algo realmente mudou', () => {
  it('loja sem lançamento: clicar nos campos e tabular por eles sem digitar nada não dispara POST', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento(), lojaSemLancamento({ id: 41, nome: 'SLZ 02' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.tab(); 
    expect(campoMarketingAlvo).toHaveFocus();
    await user.tab(); 

    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();
  });

  it('loja já lançada: editar só Faturamento Geral e sair do card dispara 1 único POST com os outros 2 valores já existentes', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaComLancamento(), lojaSemLancamento({ id: 42, nome: 'SLZ 03' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.clear(campoGeralAlvo);
    await user.type(campoGeralAlvo, '150000'); 

    await user.tab(); 
    expect(campoMarketingAlvo).toHaveFocus();
    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();

    await user.tab();

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 41,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1500,
      faturamentoMarketing: 200, 
      faturamentoRetornoIndicacao: 50, 
    });
  });

  it('loja nova na aba Marketing: preencher só Geral+Marketing (Retorno/Indicação nunca digitado) já dispara POST', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento(), lojaSemLancamento({ id: 41, nome: 'SLZ 02' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.type(campoGeralAlvo, '150000');
    await user.tab();
    await user.type(campoMarketingAlvo, '20000'); 
    await user.tab();

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 40,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1500,
      faturamentoMarketing: 200,
      faturamentoRetornoIndicacao: 0,
    });
  });

  it('loja nova na aba Marketing: preencher só o Faturamento Geral (Marketing continua vazio) já dispara POST — gate antigo removido', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento(), lojaSemLancamento({ id: 41, nome: 'SLZ 02' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const campoGeralAlvo = camposGeral[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.type(campoGeralAlvo, '150000');
    await user.tab(); 
    await user.tab();

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 40,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1500,
      faturamentoMarketing: 0,
      faturamentoRetornoIndicacao: 0,
    });
  });

  it('loja já lançada: limpar os 3 campos (todos zero/vazios) dispara DELETE em vez de POST', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({
        lojas: [
          lojaComLancamento({ faturamentoRetornoIndicacao: 0 }),
          lojaSemLancamento({ id: 42, nome: 'SLZ 03' }),
        ],
      }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.clear(campoGeralAlvo);
    await user.tab();
    await user.clear(campoMarketingAlvo);
    await user.tab();

    await waitFor(() => expect(marketingApi.removerEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.removerEntrada).toHaveBeenCalledWith({
      ano: expect.any(Number),
      mes: expect.any(Number),
      lojaId: 41,
    });
    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();
  });
  it('loja SEM lançamento anterior, digitar 0 nos campos editáveis: dispara DELETE (removerEntrada), não fica em silêncio', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento(), lojaSemLancamento({ id: 41, nome: 'SLZ 02' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.type(campoGeralAlvo, '0');
    await user.tab(); 
    await user.type(campoMarketingAlvo, '0');
    await user.tab(); 

    await waitFor(() => expect(marketingApi.removerEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.removerEntrada).toHaveBeenCalledWith({
      ano: expect.any(Number),
      mes: expect.any(Number),
      lojaId: 40,
    });
    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();
  });
  it('loja COM valor real já salvo: zerar só 1 dos 3 campos (mantendo os outros 2) dispara POST, não DELETE', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({
        lojas: [
          lojaComLancamento({ faturamentoGeral: 1000, faturamentoMarketing: 200, faturamentoRetornoIndicacao: 50 }),
          lojaSemLancamento({ id: 42, nome: 'SLZ 03' }),
        ],
      }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const camposMarketing = screen.getAllByLabelText('Faturamento Marketing');
    const campoGeralAlvo = camposGeral[0];
    const campoMarketingAlvo = camposMarketing[0];

    const user = userEvent.setup();
    await user.click(campoMarketingAlvo);
    await user.clear(campoMarketingAlvo);
    await user.tab();

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 41,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1000, 
      faturamentoMarketing: 0, 
      faturamentoRetornoIndicacao: 50, 
    });
    expect(marketingApi.removerEntrada).not.toHaveBeenCalled();
    void campoGeralAlvo;
  });
});

describe('MarketingPage — estados de carregamento/erro/vazio', () => {
  it('sem diretor selecionado: mostra mensagem pedindo pra selecionar um diretor (mesmo com dados carregados)', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento()] }),
    ]);

    render(<MarketingPage />);
    await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());

    expect(screen.getByText('Selecione um diretor acima para ver e lançar o faturamento das redes/lojas dele.')).toBeInTheDocument();
  });

  it('nenhum diretor/rede/loja cadastrado: mostra mensagem de catálogo vazio', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([]);

    render(<MarketingPage />);
    await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());

    expect(screen.getByText(/Nenhum diretor, rede ou loja cadastrado\(a\) ainda\./)).toBeInTheDocument();
  });

  it('erro de rede ao carregar: mostra mensagem de erro com botão "Tentar novamente"', async () => {
    marketingApi.fetchEntradas.mockRejectedValue(new Error('Falha de rede simulada'));

    render(<MarketingPage />);

    await waitFor(() => expect(screen.getByText(/Não foi possível carregar as entradas de marketing/)).toBeInTheDocument());
    expect(screen.getByText(/Falha de rede simulada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('estado "Carregando..." aparece enquanto a promise de fetchEntradas não resolveu', async () => {
    let resolveFetch;
    const pendente = new Promise(resolve => { resolveFetch = resolve; });
    marketingApi.fetchEntradas.mockReturnValue(pendente);

    render(<MarketingPage />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();

    resolveFetch([]);
    await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  });
});
