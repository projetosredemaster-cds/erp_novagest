import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImportacaoPage from './ImportacaoPage.jsx';

vi.mock('./importacaoApi.js', () => ({
  importarContatos: vi.fn(),
  fetchHistoricoImportacoes: vi.fn(),
  fetchDetalheImportacao: vi.fn(),
}));

vi.mock('../../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as importacaoApi from './importacaoApi.js';
import { useAuth } from '../../../app/AuthContext.jsx';

function loteHistorico(overrides = {}) {
  return {
    loteImportacaoId: 12,
    nomeArquivo: 'clientes_agosto.xlsx',
    usuarioEmail: 'liv@teste.com',
    totalLinhas: 150,
    totalImportados: 148,
    totalSemEstado: 0,
    totalDuplicado: 2,
    totalErro: 0,
    criado_em: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function detalheLote(overrides = {}) {
  return {
    loteImportacaoId: 12,
    nomeArquivo: 'clientes_agosto.xlsx',
    usuarioEmail: 'liv@teste.com',
    totalLinhas: 150,
    totalImportados: 148,
    totalSemEstado: 0,
    totalDuplicado: 2,
    totalErro: 0,
    criado_em: '2026-01-01T00:00:00.000Z',
    porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 148 }],
    erros: [
      {
        linha: 7,
        tipo: 'duplicado',
        nomePlanilha: 'João Silva',
        contatoPlanilha: '5598900000000',
        motivo: 'Telefone já cadastrado.',
        contatoExistenteId: 5,
      },
    ],
    ...overrides,
  };
}

function makeFile(name = 'clientes.csv') {
  return new File(['NOME,CONTATO\nFulano,5598984761733\n'], name, { type: 'text/csv' });
}

async function renderPage() {
  const utils = render(<ImportacaoPage />);
  await waitFor(() => expect(screen.queryAllByText('Carregando...')).toHaveLength(0));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
});

describe('ImportacaoPage — histórico: loading/erro/vazio', () => {
  it('loading: mostra "Carregando..." enquanto o histórico não resolve', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockReturnValue(new Promise(() => {}));

    render(<ImportacaoPage />);

    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
  });

  it('erro: fetchHistoricoImportacoes rejeitado mostra mensagem e botão "Tentar novamente"', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockRejectedValue(new Error('Falha ao buscar histórico'));

    render(<ImportacaoPage />);

    expect(await screen.findByText(/Não foi possível carregar o histórico de importações: Falha ao buscar histórico/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('vazio: nenhuma importação mostra a mensagem de estado vazio', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByText('Nenhuma importação realizada ainda.')).toBeInTheDocument();
  });

  it('lista itens do histórico com nome do arquivo, totais e e-mail de quem importou', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);

    await renderPage();

    expect(screen.getByText('clientes_agosto.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/148 importados de 150/)).toBeInTheDocument();
    expect(screen.getByText(/2 duplicado\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/liv@teste.com/)).toBeInTheDocument();
  });

  it('mostra "usuário removido" quando usuarioEmail vem null', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico({ usuarioEmail: null })]);

    await renderPage();

    expect(screen.getByText(/usuário removido/)).toBeInTheDocument();
  });
});

describe('ImportacaoPage — upload', () => {
  it('validação: não chama a API quando nenhum arquivo foi selecionado', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([]);
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(await screen.findByText('Selecione um arquivo .xlsx ou .csv.')).toBeInTheDocument();
    expect(importacaoApi.importarContatos).not.toHaveBeenCalled();
  });

  it('sucesso: chama importarContatos, mostra o resumo (sem nenhum seletor de número) e recarrega o histórico', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([]);
    importacaoApi.importarContatos.mockResolvedValue({
      loteImportacaoId: 20,
      totalLinhas: 10,
      totalImportados: 8,
      totalSemEstado: 1,
      totalDuplicado: 1,
      totalErro: 0,
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 8 }],
      criado_em: '2026-01-01T00:00:00.000Z',
    });

    await renderPage();

    const file = makeFile();
    fireEvent.change(screen.getByLabelText('Arquivo de contatos'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    await waitFor(() => expect(importacaoApi.importarContatos).toHaveBeenCalledWith('token-teste', file));

    expect(await screen.findByText('Resumo da importação')).toBeInTheDocument();
    expect(screen.getByText(/Importação concluída — os contatos já estão disponíveis no Painel de Disparo\./)).toBeInTheDocument();
    expect(screen.getByText('Maranhão (MA)')).toBeInTheDocument();
    expect(screen.getByText('8 contato(s)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument();
    await waitFor(() => expect(importacaoApi.fetchHistoricoImportacoes).toHaveBeenCalledTimes(2));
  });

  it('erro: mostra a mensagem de erro da API sem abrir o resumo', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([]);
    importacaoApi.importarContatos.mockRejectedValue(new Error('Formato de arquivo não suportado. Envie .xlsx ou .csv.'));

    await renderPage();

    fireEvent.change(screen.getByLabelText('Arquivo de contatos'), { target: { files: [makeFile('clientes.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(await screen.findByText('Formato de arquivo não suportado. Envie .xlsx ou .csv.')).toBeInTheDocument();
    expect(screen.queryByText('Resumo da importação')).not.toBeInTheDocument();
  });

  it('"Fechar" some com o resumo pós-upload', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([]);
    importacaoApi.importarContatos.mockResolvedValue({
      loteImportacaoId: 20,
      totalLinhas: 1,
      totalImportados: 1,
      totalSemEstado: 0,
      totalDuplicado: 0,
      totalErro: 0,
      porEstado: [],
      criado_em: '2026-01-01T00:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Arquivo de contatos'), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await screen.findByText('Resumo da importação');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));

    expect(screen.queryByText('Resumo da importação')).not.toBeInTheDocument();
  });
});

describe('ImportacaoPage — detalhe de um lote', () => {
  it('clicar num item do histórico abre o detalhe (loading, depois resumo/porEstado/erros)', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);
    importacaoApi.fetchDetalheImportacao.mockReturnValue(new Promise(() => {}));

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /clientes_agosto.xlsx/ }));

    expect(await screen.findByText('Detalhe da importação')).toBeInTheDocument();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(importacaoApi.fetchDetalheImportacao).toHaveBeenCalledWith('token-teste', 12);
  });

  it('sucesso: mostra resumo, porEstado e a lista de erros', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);
    importacaoApi.fetchDetalheImportacao.mockResolvedValue(detalheLote());

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /clientes_agosto.xlsx/ }));

    await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());

    expect(screen.getByText('Maranhão (MA)')).toBeInTheDocument();
    expect(screen.getByText('148 contato(s)')).toBeInTheDocument();
    expect(screen.getByText('João Silva')).toBeInTheDocument();
    expect(screen.getByText('Telefone já cadastrado.')).toBeInTheDocument();
    expect(screen.getByText('Duplicado')).toBeInTheDocument();
  });

  it('sem erros: mostra "Nenhum erro nesta importação."', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);
    importacaoApi.fetchDetalheImportacao.mockResolvedValue(detalheLote({ erros: [] }));

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /clientes_agosto.xlsx/ }));

    expect(await screen.findByText('Nenhum erro nesta importação.')).toBeInTheDocument();
  });

  it('404: mostra "Importação não encontrada." com botão para voltar ao histórico', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);
    importacaoApi.fetchDetalheImportacao.mockRejectedValue(new Error('Importação não encontrada.'));

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /clientes_agosto.xlsx/ }));

    expect(await screen.findByText('Importação não encontrada.')).toBeInTheDocument();
    const botoesVoltar = screen.getAllByRole('button', { name: 'Voltar ao histórico' });
    expect(botoesVoltar.length).toBeGreaterThan(0);

    fireEvent.click(botoesVoltar[botoesVoltar.length - 1]);

    expect(screen.getByText('Histórico de importações')).toBeInTheDocument();
    expect(screen.queryByText('Detalhe da importação')).not.toBeInTheDocument();
  });

  it('"Voltar ao histórico" a partir de um detalhe carregado com sucesso volta para a lista', async () => {
    importacaoApi.fetchHistoricoImportacoes.mockResolvedValue([loteHistorico()]);
    importacaoApi.fetchDetalheImportacao.mockResolvedValue(detalheLote());

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /clientes_agosto.xlsx/ }));
    await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao histórico' }));

    expect(screen.getByText('Histórico de importações')).toBeInTheDocument();
    expect(screen.queryByText('Detalhe da importação')).not.toBeInTheDocument();
  });
});
