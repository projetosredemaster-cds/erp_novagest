import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImportacaoPage from './ImportacaoPage.jsx';

vi.mock('./importacaoApi.js', () => ({
  importarContatos: vi.fn(),
  confirmarImportacao: vi.fn(),
  fetchImportacoesPendentes: vi.fn(),
}));

vi.mock('../configuracoes/controleLigacoesConfigApi.js', () => ({
  fetchEstados: vi.fn(),
  fetchNumerosRemetentes: vi.fn(),
}));

vi.mock('../../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as importacaoApi from './importacaoApi.js';
import * as configApi from '../configuracoes/controleLigacoesConfigApi.js';
import { useAuth } from '../../../app/AuthContext.jsx';

function numeroMaranhao({ id = 3, apelido = 'CDC Cohatrac', ativo = true } = {}) {
  return { id, apelido, ativo, estado: { id: 6, nome: 'Maranhão', uf: 'MA' } };
}

function mockCargaBasica({ numeros, estados, pendentes } = {}) {
  configApi.fetchNumerosRemetentes.mockResolvedValue(numeros ?? [numeroMaranhao()]);
  configApi.fetchEstados.mockResolvedValue(estados ?? [{ id: 6, nome: 'Maranhão', uf: 'MA' }]);
  importacaoApi.fetchImportacoesPendentes.mockResolvedValue(pendentes ?? []);
}

async function renderPage() {
  const utils = render(<ImportacaoPage />);
  await waitFor(() => expect(screen.queryAllByText('Carregando...')).toHaveLength(0));
  return utils;
}

function makeFile(name = 'clientes.csv') {
  return new File(['NOME,CONTATO\nFulano,5598984761733\n'], name, { type: 'text/csv' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
});

describe('ImportacaoPage — importações pendentes: loading/erro/vazio', () => {
  it('loading: mostra "Carregando..." enquanto a lista de pendentes não resolve', async () => {
    importacaoApi.fetchImportacoesPendentes.mockReturnValue(new Promise(() => {}));
    configApi.fetchNumerosRemetentes.mockResolvedValue([]);
    configApi.fetchEstados.mockResolvedValue([]);

    render(<ImportacaoPage />);

    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
  });

  it('erro: fetchImportacoesPendentes rejeitado mostra mensagem e botão "Tentar novamente"', async () => {
    importacaoApi.fetchImportacoesPendentes.mockRejectedValue(new Error('Falha ao buscar pendentes'));
    configApi.fetchNumerosRemetentes.mockResolvedValue([]);
    configApi.fetchEstados.mockResolvedValue([]);

    render(<ImportacaoPage />);

    expect(await screen.findByText(/Não foi possível carregar as importações pendentes: Falha ao buscar pendentes/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('vazio: nenhuma pendência mostra a mensagem de estado vazio', async () => {
    mockCargaBasica({ pendentes: [] });

    await renderPage();

    expect(screen.getByText('Nenhuma importação pendente.')).toBeInTheDocument();
  });

  it('lista pendências com nome do arquivo e total importado', async () => {
    mockCargaBasica({
      pendentes: [{ loteImportacaoId: 12, nomeArquivo: 'clientes_agosto.xlsx', totalImportados: 148, criado_em: '2026-01-01T00:00:00.000Z' }],
    });

    await renderPage();

    expect(screen.getByText('clientes_agosto.xlsx')).toBeInTheDocument();
    expect(screen.getByText(/148 contato\(s\)/)).toBeInTheDocument();
  });
});

describe('ImportacaoPage — upload', () => {
  it('validação: não chama a API quando nenhum arquivo foi selecionado', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(await screen.findByText('Selecione um arquivo .xlsx ou .csv.')).toBeInTheDocument();
    expect(importacaoApi.importarContatos).not.toHaveBeenCalled();
  });

  it('sucesso: chama importarContatos com o arquivo e abre a etapa de confirmação com o resumo', async () => {
    mockCargaBasica();
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
    expect(screen.getByText('Maranhão (MA)')).toBeInTheDocument();
    expect(screen.getByText('8 contato(s)')).toBeInTheDocument();
    expect(screen.getByText('Arquivo importado. Confira o resumo e escolha os números.')).toBeInTheDocument();
  });

  it('erro: mostra a mensagem de erro da API sem abrir a etapa de confirmação', async () => {
    mockCargaBasica();
    importacaoApi.importarContatos.mockRejectedValue(new Error('Formato de arquivo não suportado. Envie .xlsx ou .csv.'));

    await renderPage();

    fireEvent.change(screen.getByLabelText('Arquivo de contatos'), { target: { files: [makeFile('clientes.txt')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));

    expect(await screen.findByText('Formato de arquivo não suportado. Envie .xlsx ou .csv.')).toBeInTheDocument();
    expect(screen.queryByText('Resumo da importação')).not.toBeInTheDocument();
  });
});

describe('ImportacaoPage — confirmação (fluxo "novo")', () => {
  async function abrirResumo({ semNumeroAtivo = false } = {}) {
    mockCargaBasica({ numeros: semNumeroAtivo ? [] : [numeroMaranhao()] });
    importacaoApi.importarContatos.mockResolvedValue({
      loteImportacaoId: 20,
      totalLinhas: 1,
      totalImportados: 1,
      totalSemEstado: 0,
      totalDuplicado: 0,
      totalErro: 0,
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 1 }],
      criado_em: '2026-01-01T00:00:00.000Z',
    });

    await renderPage();
    fireEvent.change(screen.getByLabelText('Arquivo de contatos'), { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await screen.findByText('Resumo da importação');
  }

  it('botão "Confirmar distribuição" começa desabilitado até escolher um número para cada estado', async () => {
    await abrirResumo();

    expect(screen.getByRole('button', { name: 'Confirmar distribuição' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Número remetente para Maranhão'), { target: { value: '3' } });

    expect(screen.getByRole('button', { name: 'Confirmar distribuição' })).not.toBeDisabled();
  });

  it('avisa quando não há número ativo para um estado do resumo', async () => {
    await abrirResumo({ semNumeroAtivo: true });

    expect(screen.getByText('Nenhum número ativo para este estado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar distribuição' })).toBeDisabled();
  });

  it('sucesso: chama confirmarImportacao com as escolhas, mostra flash e recarrega pendentes', async () => {
    await abrirResumo();
    importacaoApi.confirmarImportacao.mockResolvedValue({ loteImportacaoId: 20, confirmado: true });
    importacaoApi.fetchImportacoesPendentes.mockResolvedValue([]);

    fireEvent.change(screen.getByLabelText('Número remetente para Maranhão'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar distribuição' }));

    await waitFor(() => expect(importacaoApi.confirmarImportacao).toHaveBeenCalledWith(
      'token-teste', 20, [{ estadoId: 6, numeroRemetenteId: 3 }]
    ));

    expect(await screen.findByText('Distribuição confirmada com sucesso.')).toBeInTheDocument();
    expect(screen.queryByText('Resumo da importação')).not.toBeInTheDocument();
  });

  it('erro (400 do backend) mostra a mensagem sem sair da etapa de confirmação', async () => {
    await abrirResumo();
    importacaoApi.confirmarImportacao.mockRejectedValue(new Error(
      'Número remetente informado é inválido para o estado "Maranhão".'
    ));

    fireEvent.change(screen.getByLabelText('Número remetente para Maranhão'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar distribuição' }));

    expect(await screen.findByText('Número remetente informado é inválido para o estado "Maranhão".')).toBeInTheDocument();
    expect(screen.getByText('Resumo da importação')).toBeInTheDocument();
  });

  it('"Cancelar" fecha a etapa de confirmação sem chamar a API', async () => {
    await abrirResumo();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByText('Resumo da importação')).not.toBeInTheDocument();
    expect(importacaoApi.confirmarImportacao).not.toHaveBeenCalled();
  });
});

describe('ImportacaoPage — retomada de uma importação pendente', () => {
  it('"Retomar" abre a tela de confirmação com linhas dinâmicas Estado+Número (não vem pré-preenchido)', async () => {
    mockCargaBasica({
      pendentes: [{ loteImportacaoId: 12, nomeArquivo: 'clientes_agosto.xlsx', totalImportados: 148, criado_em: '2026-01-01T00:00:00.000Z' }],
    });

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar' }));

    expect(await screen.findByText('Retomar importação pendente')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Confirmar distribuição' })).toBeDisabled();
  });

  it('"+ Adicionar outro estado" adiciona uma nova linha; escolher estado+número habilita confirmar', async () => {
    mockCargaBasica({
      pendentes: [{ loteImportacaoId: 12, nomeArquivo: 'clientes_agosto.xlsx', totalImportados: 148, criado_em: '2026-01-01T00:00:00.000Z' }],
    });
    importacaoApi.confirmarImportacao.mockResolvedValue({ loteImportacaoId: 12, confirmado: true });

    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar' }));
    await screen.findByText('Retomar importação pendente');

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Número remetente'), { target: { value: '3' } });

    expect(screen.getByRole('button', { name: 'Confirmar distribuição' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar distribuição' }));

    await waitFor(() => expect(importacaoApi.confirmarImportacao).toHaveBeenCalledWith(
      'token-teste', 12, [{ estadoId: 6, numeroRemetenteId: 3 }]
    ));
  });
});
