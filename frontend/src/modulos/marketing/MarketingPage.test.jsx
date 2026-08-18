// Testes de componente (Vitest + React Testing Library) de MarketingPage.jsx, cobrindo o
// bugfix do onBlur disparando POST sem mudança real e a escolha POST-vs-DELETE no blur (ver
// CONTRATO-MARKETING-API.md, seções 2 e 3, e comentário de handleBlurLoja em
// MarketingPage.jsx). `marketingApi.js` é totalmente mockado — nenhuma chamada de rede real
// acontece aqui, mesmo padrão de MargensPage.test.jsx/RankingPage.test.jsx.
//
// Cobre os testes de aceitação da tarefa original de bugfix, mais a troca do gate por aba
// (`preenchidosNaAba`) pela decisão POST-vs-DELETE baseada nos 3 valores atuais (ver
// comentário de handleBlurLoja):
//  - loja SEM lançamento no mês: clicar nos campos editáveis do card e tabular por eles sem
//    digitar nada não deve disparar NENHUMA chamada de rede (dirty-check em handleBlurLoja).
//  - loja já lançada (os 3 valores salvos): editar só o Faturamento Geral e sair do card
//    dispara UM ÚNICO POST, com o valor novo de Geral e os valores JÁ EXISTENTES de
//    Marketing/Retorno-Indicação (não zerados) — cobre também a consolidação de blur por
//    card via relatedTarget (tabular do 1º pro 2º campo do MESMO card não dispara nada;
//    só tabular pra FORA do card dispara).
//  - loja nova, só com Geral preenchido (Marketing e Retorno/Indicação nunca digitados):
//    dispara POST normal com os outros dois campos como 0 — não bloqueia mais (gate antigo
//    removido; "zero pode ser dado real", contrato seção 2).
//  - loja já lançada: limpar os 3 campos até ficarem todos zero/vazios dispara DELETE
//    (`removerEntrada`) em vez de POST, e a linha volta ao shape "sem lançamento".
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
  // evita que um POST/DELETE disparado por engano quebre com "undefined.then" em vez de
  // falhar de forma clara na asserção `not.toHaveBeenCalled()`.
  marketingApi.salvarEntrada.mockResolvedValue({ atualizadoEm: '2026-08-18T12:00:00.000Z' });
  marketingApi.removerEntrada.mockResolvedValue(undefined);
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

  it('loja nova na aba Marketing: preencher só o Faturamento Geral (Marketing continua vazio) já dispara POST — gate antigo removido', async () => {
    // Cobre a revisão do gate pedida na tarefa: antes bloqueava POST se algum campo da aba
    // ativa estivesse vazio; agora "todos zero" tem tratamento próprio (branch de DELETE,
    // testado no teste seguinte), então preencher só 1 dos 3 campos não bloqueia mais — zero
    // nos outros dois pode ser um dado real (contrato, seção 2).
    marketingApi.fetchEntradas.mockResolvedValue([
      bloco({ lojas: [lojaSemLancamento(), lojaSemLancamento({ id: 41, nome: 'SLZ 02' })] }),
    ]);

    await renderESelecionarDiretor();

    const camposGeral = await screen.findAllByLabelText('Faturamento Geral');
    const campoGeralAlvo = camposGeral[0];

    const user = userEvent.setup();
    await user.click(campoGeralAlvo);
    await user.type(campoGeralAlvo, '150000'); // R$ 1.500,00
    await user.tab(); // Geral -> Marketing, mesmo card: ainda não dispara
    await user.tab(); // Marketing -> fora do card, sem digitar nada nele: dispara mesmo assim

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
    // faturamentoRetornoIndicacao já nasce 0 (loja com marketing lançado mas sem
    // retorno/indicação) — só precisa zerar Geral e Marketing na aba ativa pra atingir
    // "os 3 valores atuais são zero/vazios" e cair no branch de removerEntrada.
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
    await user.tab(); // Geral -> Marketing, mesmo card: ainda não dispara
    await user.clear(campoMarketingAlvo);
    await user.tab(); // Marketing -> fora do card: dispara

    await waitFor(() => expect(marketingApi.removerEntrada).toHaveBeenCalledTimes(1));
    expect(marketingApi.removerEntrada).toHaveBeenCalledWith({
      ano: expect.any(Number),
      mes: expect.any(Number),
      lojaId: 41,
    });
    expect(marketingApi.salvarEntrada).not.toHaveBeenCalled();
  });
});
