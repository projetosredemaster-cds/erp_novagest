// Testes de componente (Vitest + React Testing Library) de RelatorioMarketing.jsx.
// `marketingApi.js` é totalmente mockado — nenhuma chamada de rede real acontece aqui.
//
// Foco principal (item explicitamente pedido no ciclo de QA): confirmar que a cor de cada
// célula da tabela usa a comparação calculada NO CLIENTE mês-a-mês (compararTotais, sobre o
// `percentualMarketing` de duas chamadas de fetchEntradas diferentes), e NÃO o campo
// `comparacao` que a API devolve dentro de cada lançamento — são fontes de comparação
// diferentes (ver comentário de calcularCelula em RelatorioMarketing.jsx e nota no CLAUDE.md).
// O teste força os dois valores a DIVERGIREM deliberadamente (a API manda
// `comparacao.faturamentoMarketing` num sentido, mas o percentual bruto manda no sentido
// oposto quando comparado entre os dois meses) e verifica qual dos dois realmente pinta a
// célula.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import RelatorioMarketing from './RelatorioMarketing.jsx';

vi.mock('./marketingApi', () => ({
  fetchEntradas: vi.fn(),
}));

import * as marketingApi from './marketingApi';

const DIRETORES = [{ id: 1, nome: 'Victor Hugo', redes: [] }];

function blocoComLoja({ percentualMarketing, comparacaoFaturamentoMarketing }) {
  return [
    {
      diretor: { id: 1, nome: 'Victor Hugo' },
      rede: { id: 5, nome: 'Delta' },
      lojas: [
        {
          id: 40,
          nome: 'SLZ 01',
          faturamentoGeral: 1000,
          faturamentoMarketing: percentualMarketing !== null ? (percentualMarketing / 100) * 1000 : null,
          faturamentoRetornoIndicacao: 0,
          percentualMarketing,
          percentualRetornoIndicacao: 0,
          comparacao: percentualMarketing === null ? null : {
            faturamentoGeral: 'igual',
            faturamentoMarketing: comparacaoFaturamentoMarketing,
            faturamentoRetornoIndicacao: 'igual',
          },
          atualizadoEm: '2026-08-01T00:00:00.000Z',
        },
      ],
    },
  ];
}

async function definirPeriodo(mesInicio, mesFim) {
  const inputInicio = screen.getByLabelText('Mês inicial');
  const inputFim = screen.getByLabelText('Mês final');
  fireEvent.change(inputInicio, { target: { value: mesInicio } });
  fireEvent.change(inputFim, { target: { value: mesFim } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// localiza a linha ("tr") da loja e devolve as células de dado (uma por período visível,
// pulando a 1ª coluna que é o nome da loja) — evita ambiguidade de `getByText` quando o
// mesmo percentual aparece em mais de uma célula (ex.: linha de subtotal repete o valor da
// única loja da rede).
function celulasDaLinhaLoja(nomeLoja) {
  const linha = screen.getByText(nomeLoja).closest('tr');
  return Array.from(linha.querySelectorAll('td')).slice(1);
}

describe('RelatorioMarketing — cor de célula usa a comparação calculada no CLIENTE, não o campo "comparacao" da API', () => {
  it('percentual SOBE de um mês pro outro (calculado no cliente) mesmo com a API mandando comparacao.faturamentoMarketing: "caiu" -> célula pinta como ALTA (verde)', async () => {
    // 3 chamadas: mês "anterior" (só apoio de cor da 1ª coluna), 2026-07 (1ª col visível),
    // 2026-08 (2ª col visível, mais recente -> define a árvore Diretor/Rede/Loja).
    marketingApi.fetchEntradas.mockImplementation(({ ano, mes }) => {
      const chave = `${ano}-${mes}`;
      if (chave === '2026-6') return Promise.resolve(blocoComLoja({ percentualMarketing: 10, comparacaoFaturamentoMarketing: 'igual' }));
      if (chave === '2026-7') return Promise.resolve(blocoComLoja({ percentualMarketing: 25, comparacaoFaturamentoMarketing: 'caiu' })); // API diz "caiu", mas 10->25 subiu de verdade
      if (chave === '2026-8') return Promise.resolve(blocoComLoja({ percentualMarketing: 25, comparacaoFaturamentoMarketing: 'igual' })); // igual ao mês anterior visível — sem cor
      return Promise.resolve([]);
    });

    render(<RelatorioMarketing diretorId={1} diretores={DIRETORES} />);
    await definirPeriodo('2026-07', '2026-08');

    await waitFor(() => expect(screen.getByText('SLZ 01')).toBeInTheDocument());

    const [celulaJulho, celulaAgosto] = celulasDaLinhaLoja('SLZ 01');
    // coluna 07/2026: percentual 25%, comparado ao mês "anterior" 06/2026 (10%) -> subiu de
    // verdade no cálculo do cliente, mesmo a API tendo mandado comparacao.faturamentoMarketing:
    // "caiu" nesse lançamento — a célula deve pintar verde (client), não ficar sem cor (API).
    expect(celulaJulho.textContent).toBe('25,00%');
    expect(celulaJulho.className).toContain('text-emerald-400'); // SETA_PERCENTUAL.subiu.classe
    expect(celulaJulho.className).not.toContain('text-orange-400');
    // coluna 08/2026: 25% igual a 07/2026 (25%) -> sem cor
    expect(celulaAgosto.className).not.toContain('text-emerald-400');
    expect(celulaAgosto.className).not.toContain('text-orange-400');
  });

  it('percentual CAI de um mês pro outro (calculado no cliente) mesmo com a API mandando comparacao.faturamentoMarketing: "subiu" -> célula pinta como QUEDA (laranja)', async () => {
    marketingApi.fetchEntradas.mockImplementation(({ ano, mes }) => {
      const chave = `${ano}-${mes}`;
      if (chave === '2026-6') return Promise.resolve(blocoComLoja({ percentualMarketing: 50, comparacaoFaturamentoMarketing: 'igual' }));
      if (chave === '2026-7') return Promise.resolve(blocoComLoja({ percentualMarketing: 50, comparacaoFaturamentoMarketing: 'igual' }));
      if (chave === '2026-8') return Promise.resolve(blocoComLoja({ percentualMarketing: 15, comparacaoFaturamentoMarketing: 'subiu' })); // API diz "subiu", mas 50->15 caiu de verdade
      return Promise.resolve([]);
    });

    render(<RelatorioMarketing diretorId={1} diretores={DIRETORES} />);
    await definirPeriodo('2026-07', '2026-08');

    await waitFor(() => expect(screen.getByText('SLZ 01')).toBeInTheDocument());

    const [celulaJulho, celulaAgosto] = celulasDaLinhaLoja('SLZ 01');
    expect(celulaJulho.className).not.toContain('text-emerald-400');
    expect(celulaJulho.className).not.toContain('text-orange-400'); // 06->07: 50 -> 50, igual
    expect(celulaAgosto.textContent).toBe('15,00%');
    expect(celulaAgosto.className).toContain('text-orange-400'); // SETA_PERCENTUAL.caiu.classe (client)
    expect(celulaAgosto.className).not.toContain('text-emerald-400');
  });
});

describe('RelatorioMarketing — estados', () => {
  it('sem diretor selecionado: mostra mensagem pedindo pra selecionar um diretor', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([]);

    render(<RelatorioMarketing diretorId="" diretores={DIRETORES} />);

    await waitFor(() => expect(screen.getByText('Selecione um diretor acima para ver o relatório de visão geral dele.')).toBeInTheDocument());
  });

  it('erro de rede ao carregar: mostra mensagem de erro com botão "Tentar novamente"', async () => {
    marketingApi.fetchEntradas.mockRejectedValue(new Error('Falha de rede simulada'));

    render(<RelatorioMarketing diretorId={1} diretores={DIRETORES} />);

    await waitFor(() => expect(screen.getByText(/Não foi possível carregar o relatório de marketing/)).toBeInTheDocument());
    expect(screen.getByText(/Falha de rede simulada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('nenhuma rede/loja para o diretor no período: mostra mensagem específica', async () => {
    marketingApi.fetchEntradas.mockResolvedValue([]);

    render(<RelatorioMarketing diretorId={1} diretores={DIRETORES} />);

    await waitFor(() => expect(screen.getByText('Nenhuma rede/loja encontrada para este diretor no período selecionado.')).toBeInTheDocument());
  });
});
