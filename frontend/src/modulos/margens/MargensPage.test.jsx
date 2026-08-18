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

describe('MargensPage — linha de loja nasce em modo "margem" (padrão)', () => {
  it('mostra só o campo "Margem (%)" e o botão "Calcular pelo Total Tar", sem o Total Tar visível', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(screen.getByLabelText('Margem (%)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Total Tar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calcular pelo Total Tar' })).toBeInTheDocument();
  });

  it('classifica verde (>=41), amarelo (>=40) e vermelho (<40) direto da margem digitada, sem depender do Total Tar', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    const campoMargem = screen.getByLabelText('Margem (%)');

    fireEvent.change(campoMargem, { target: { value: '4100' } }); // 41,00%
    expect(screen.getByText('41,00%')).toHaveClass('bg-emerald-500/15');

    fireEvent.change(campoMargem, { target: { value: '4000' } }); // 40,00%
    expect(screen.getByText('40,00%')).toHaveClass('bg-amber-500/15');

    fireEvent.change(campoMargem, { target: { value: '3900' } }); // 39,00%
    expect(screen.getByText('39,00%')).toHaveClass('bg-red-500/15');
  });

  it('botão "Confirmar" fica desabilitado enquanto nada foi digitado', async () => {
    mockCargaBasica();

    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });
});

describe('MargensPage — confirmar via margem digitada (fonte autoritativa padrão)', () => {
  it('deriva o totalTar e envia margemInformada; após sucesso, desabilita os campos com o selo "Confirmado"', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 10000, margemInformada: 50,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '10000000' } }); // 100.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '4000000' } }); // 40.000,00
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '5000' } }); // 50,00%

    const botaoConfirmar = screen.getByRole('button', { name: 'Confirmar' });
    expect(botaoConfirmar).not.toBeDisabled();
    fireEvent.click(botaoConfirmar);

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 100000,
      custoProduto: 40000,
      totalTar: 10000,
      margemInformada: 50,
    }));

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByLabelText('Total Tar')).toBeDisabled();
  });

  it('margem 90,00% -> totalTar derivado negativo (-30.000) é enviado como está (validação de totalTar>=0 é do backend)', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 901, data_ref: '2026-07-29T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: -30000, margemInformada: 90,
      atualizado_em: '2026-07-29T18:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '10000000' } }); // 100.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '4000000' } }); // 40.000,00
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '9000' } }); // 90,00%

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 100000,
      custoProduto: 40000,
      totalTar: -30000,
      margemInformada: 90,
    }));
  });
});

describe('MargensPage — revelar e usar o Total Tar (fonte autoritativa quando preenchido)', () => {
  it('"Calcular pelo Total Tar" revela o campo; preenchê-lo sobrepõe a margem digitada na cor/percentual exibidos', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '100000' } }); // 1.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '59000' } }); // 590,00
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '9000' } }); // 90,00% (seria vermelho... na verdade verde, mas será sobreposto)

    fireEvent.click(screen.getByRole('button', { name: 'Calcular pelo Total Tar' }));
    expect(screen.getByRole('button', { name: 'Ocultar Total Tar' })).toBeInTheDocument();

    const campoTar = screen.getByLabelText('Total Tar');
    fireEvent.change(campoTar, { target: { value: '2000' } }); // 20,00 -> margem (1000-590-20)/1000 = 39,00%

    expect(screen.getByText('39,00%')).toHaveClass('bg-red-500/15');
  });

  it('confirmar com Total Tar preenchido envia o valor digitado direto e margemInformada: null', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 902, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: null,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '10000000' } }); // 100.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '4000000' } }); // 40.000,00

    fireEvent.click(screen.getByRole('button', { name: 'Calcular pelo Total Tar' }));
    fireEvent.change(screen.getByLabelText('Total Tar'), { target: { value: '500000' } }); // 5.000,00

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 100000,
      custoProduto: 40000,
      totalTar: 5000,
      margemInformada: null,
    }));

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
  });

  it('regressão de precedência: Total Tar E margem digitada preenchidos ao mesmo tempo — Total Tar vence, margemInformada: null, ignora a margem digitada', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 903, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 7000, margemInformada: null,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '10000000' } }); 
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '4000000' } });
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '9000' } });

    fireEvent.click(screen.getByRole('button', { name: 'Calcular pelo Total Tar' }));
    fireEvent.change(screen.getByLabelText('Total Tar'), { target: { value: '700000' } }); 

    expect(screen.getByText('53,00%')).toHaveClass('bg-emerald-500/15');

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 100000,
      custoProduto: 40000,
      totalTar: 7000, 
      margemInformada: null,
    }));

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
  });

  it('revelar o Total Tar, digitar nele e depois apagar tudo (campo vazio) faz a margem digitada voltar a mandar', async () => {
    mockCargaBasica();
    margensApi.salvarEntrada.mockResolvedValue({
      id: 904, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 1000, custoProduto: 400, totalTar: 100, margemInformada: 50,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Faturamento'), { target: { value: '100000' } }); // 1.000,00
    fireEvent.change(screen.getByLabelText('Custo geral de produtos'), { target: { value: '40000' } }); // 400,00
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '5000' } }); // 50,00%

    fireEvent.click(screen.getByRole('button', { name: 'Calcular pelo Total Tar' }));
    const campoTar = screen.getByLabelText('Total Tar');

    fireEvent.change(campoTar, { target: { value: '20000' } }); // 200,00
    expect(screen.getByText('40,00%')).toHaveClass('bg-amber-500/15');

    fireEvent.change(campoTar, { target: { value: '' } });
    expect(screen.getByText('50,00%')).toHaveClass('bg-emerald-500/15');
    expect(campoTar).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(margensApi.salvarEntrada).toHaveBeenCalledWith({
      data: expect.any(String),
      lojaId: 40,
      faturamento: 1000,
      custoProduto: 400,
      totalTar: 100,
      margemInformada: 50,
    }));

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
  });
});

describe('MargensPage — editar uma loja já confirmada', () => {
  it('clicar "Editar" reabilita os campos da loja, de volta ao modo "margem" padrão', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: null, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();

    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });
    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByLabelText('Total Tar')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    expect(screen.queryByText('✓ Confirmado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.getByLabelText('Margem (%)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Total Tar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calcular pelo Total Tar' })).toBeInTheDocument();
  });
});

describe('MargensPage — loja confirmada via margem digitada mostra o valor informado', () => {
  it('exibe "Margem informada: 44,20%" ao lado da margem calculada', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5580, margemInformada: 44.2, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByText('Margem informada: 44,20%')).toBeInTheDocument();
  });

  it('não mostra "Margem informada" quando a loja foi confirmada via Total Tar (margemInformada null)', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: null, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.queryByText(/Margem informada/)).not.toBeInTheDocument();
  });
});

describe('MargensPage — após Confirmar, a margem calculada não mostra "—" quando os valores consolidados são reais (regressão do bug original)', () => {
  it('loja confirmada via margem digitada mostra a margem calculada a partir do snapshot salvo, não "—"', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 10000, margemInformada: 50, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByText('50,00%')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('loja confirmada via Total Tar mostra a margem calculada a partir do snapshot salvo, não "—"', async () => {
    mockCargaBasica({
      entradas: [
        { id: 900, loja_id: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: null, atualizado_em: '2026-07-28T18:00:00.000Z' },
      ],
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(await screen.findByText('✓ Confirmado')).toBeInTheDocument();
    expect(screen.getByText('55,00%')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
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

describe('MargensPage — alternância de modo por loja', () => {
  it('revelar o Total Tar de uma loja não afeta as outras lojas da mesma rede', async () => {
    mockCargaBasica({
      redes: [diretorComRede({
        lojas: [
          { id: 40, nome: 'Loja A', ativo: true },
          { id: 41, nome: 'Loja B', ativo: true },
        ],
      })],
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Rede'), { target: { value: '5' } });

    expect(screen.getAllByLabelText('Margem (%)')).toHaveLength(2);
    expect(screen.queryByLabelText('Total Tar')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Calcular pelo Total Tar' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Calcular pelo Total Tar' })[0]);

    expect(screen.getAllByLabelText('Margem (%)')).toHaveLength(2);
    expect(screen.getAllByLabelText('Total Tar')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ocultar Total Tar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calcular pelo Total Tar' })).toBeInTheDocument();
  });
});
