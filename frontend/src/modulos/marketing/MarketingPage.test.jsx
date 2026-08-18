// Testes de componente (Vitest + React Testing Library) de MarketingPage.jsx, cobrindo o
// bugfix do onBlur disparando POST sem mudança real (ver CONTRATO-MARKETING-API.md, seção
// 2, e comentário de handleBlurLoja em MarketingPage.jsx). `marketingApi.js` é totalmente
// mockado — nenhuma chamada de rede real acontece aqui, mesmo padrão de
// MargensPage.test.jsx/RankingPage.test.jsx.
//
// Cobre os testes de aceitação da tarefa original de bugfix, mais a revisão do gate de envio
// (relaxado por aba, ver comentário de handleBlurLoja):
//  - loja SEM lançamento no mês: clicar nos campos editáveis do card e tabular por eles sem
//    digitar nada não deve disparar NENHUM POST (dirty-check em handleBlurLoja).
//  - loja já lançada (os 3 valores salvos): editar só o Faturamento Geral e sair do card
//    dispara UM ÚNICO POST, com o valor novo de Geral e os valores JÁ EXISTENTES de
//    Marketing/Retorno-Indicação (não zerados) — cobre também a consolidação de blur por
//    card via relatedTarget (tabular do 1º pro 2º campo do MESMO card não dispara nada;
//    só tabular pra FORA do card dispara).
//  - loja nova, só com Geral+Marketing preenchidos (Retorno/Indicação nunca digitado): salva
//    normalmente na aba Marketing, sem esperar o 3º campo (gate relaxado por aba).
//
// Verificação usada: teste de componente simulado (sem browser real disponível neste
// ambiente) — ver relatório da tarefa.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketingPage from './MarketingPage.jsx';

vi.mock('./marketingApi', () => ({
  fetchEntradas: vi.fn(),
  salvarEntrada: vi.fn(),
}));

import * as marketingApi from './marketingApi';

function bloco({ diretorId = 1, diretorNome = 'Victor Hugo', redeId = 5, redeNome = 'Delta', lojas }) {
  return {
    diretor: { id: diretorId, nome: diretorNome },
    rede: { id: redeId, nome: redeNome },
    lojas: lojas || [],
  };
}

// loja nunca lançada no mês (todos os campos de valor `null`, ver contrato) — o input
// aparece vazio ('') no card, não "0".
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

// loja com os 3 valores já lançados/salvos.
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
  // resolvido por padrão em todo teste — mesmo nos testes onde não deveria ser chamado,
  // evita que um POST disparado por engano quebre com "undefined.then" em vez de falhar
  // de forma clara na asserção `not.toHaveBeenCalled()`.
  marketingApi.salvarEntrada.mockResolvedValue({ atualizadoEm: '2026-08-18T12:00:00.000Z' });
});

describe('MarketingPage — onBlur só salva quando algo realmente mudou', () => {
  it('loja sem lançamento: clicar nos campos e tabular por eles sem digitar nada não dispara POST', async () => {
    // segunda loja (dummy) só pra servir de "próximo elemento focado" ao tabular pra fora
    // do card da loja-alvo (mecanismo primário de consolidação: e.relatedTarget).
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
    await user.tab(); // Geral -> Marketing, mesmo card: não dispara
    expect(campoMarketingAlvo).toHaveFocus();
    await user.tab(); // Marketing -> fora do card (card da 2ª loja): dispara o blur consolidado,
    // mas o dirty-check bloqueia o POST porque nada mudou.

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
    await user.type(campoGeralAlvo, '150000'); // digitos crus -> R$ 1.500,00

    await user.tab(); // Geral -> Marketing, mesmo card: ainda não dispara
    expect(campoMarketingAlvo).toHaveFocus();
    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();

    await user.tab(); // Marketing -> fora do card: dispara o único POST da linha

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 41,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1500,
      faturamentoMarketing: 200, // valor já existente, não zerado
      faturamentoRetornoIndicacao: 50, // valor já existente, não zerado
    });
  });

  it('loja nova na aba Marketing: preencher só Geral+Marketing (Retorno/Indicação nunca digitado) já dispara POST', async () => {
    // gate relaxado por aba: na aba "marketing" só Geral+Marketing precisam estar
    // preenchidos pra liberar o envio — Retorno/Indicação pode continuar '' indefinidamente
    // (é preenchido, se for o caso, separadamente na aba "Cliente Retorno/Indicação").
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
    await user.type(campoGeralAlvo, '150000'); // R$ 1.500,00
    await user.tab(); // Geral -> Marketing, mesmo card: ainda não dispara
    await user.type(campoMarketingAlvo, '20000'); // R$ 200,00
    await user.tab(); // Marketing -> fora do card: dispara

    await waitFor(() => expect(marketingApi.salvarEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.salvarEntrada).toHaveBeenCalledWith({
      lojaId: 40,
      ano: expect.any(Number),
      mes: expect.any(Number),
      faturamentoGeral: 1500,
      faturamentoMarketing: 200,
      faturamentoRetornoIndicacao: 0, // nunca digitado — enviado como 0, contrato exige o campo sempre
    });
  });
});
