import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NumerosRemetentesPage from './NumerosRemetentesPage.jsx';

vi.mock('./controleLigacoesConfigApi.js', () => ({
  fetchEstados: vi.fn(),
  criarEstado: vi.fn(),
  fetchNumerosRemetentes: vi.fn(),
  criarNumeroRemetente: vi.fn(),
  atualizarNumeroRemetente: vi.fn(),
  removerNumeroRemetente: vi.fn(),
}));

vi.mock('../../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as api from './controleLigacoesConfigApi.js';
import { useAuth } from '../../../app/AuthContext.jsx';

function numero({ id = 3, apelido = 'CDC Cohatrac', ativo = true, estado } = {}) {
  return {
    id,
    apelido,
    numero: null,
    statusConexao: 'aguardando_conexao',
    ativo,
    estado: estado || { id: 6, nome: 'Maranhão', uf: 'MA' },
    criado_em: '2026-01-01T00:00:00.000Z',
  };
}

function estado({ id = 6, nome = 'Maranhão', uf = 'MA' } = {}) {
  return { id, nome, uf, ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' };
}

function mockCargaBasica({ numeros, estados } = {}) {
  api.fetchNumerosRemetentes.mockResolvedValue(numeros ?? [numero()]);
  api.fetchEstados.mockResolvedValue(estados ?? [estado()]);
}

async function renderPage() {
  const utils = render(<NumerosRemetentesPage />);
  await waitFor(() => expect(screen.queryAllByText('Carregando...')).toHaveLength(0));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
});

describe('NumerosRemetentesPage — estados de loading/erro/vazio', () => {
  it('loading: mostra "Carregando..." enquanto a lista não resolve', async () => {
    api.fetchNumerosRemetentes.mockReturnValue(new Promise(() => {}));
    api.fetchEstados.mockReturnValue(new Promise(() => {}));

    render(<NumerosRemetentesPage />);

    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
  });

  it('erro: fetchNumerosRemetentes rejeitado mostra mensagem e botão "Tentar novamente"', async () => {
    api.fetchNumerosRemetentes.mockRejectedValue(new Error('Falha ao buscar números'));
    api.fetchEstados.mockResolvedValue([]);

    render(<NumerosRemetentesPage />);

    expect(await screen.findByText(/Não foi possível carregar os números remetentes: Falha ao buscar números/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('vazio: nenhum número cadastrado mostra a mensagem de estado vazio', async () => {
    mockCargaBasica({ numeros: [] });

    await renderPage();

    expect(screen.getByText('Nenhum número remetente cadastrado.')).toBeInTheDocument();
  });

  it('"Tentar novamente" recarrega a lista com sucesso', async () => {
    api.fetchNumerosRemetentes.mockRejectedValueOnce(new Error('Falha ao buscar números'));
    api.fetchEstados.mockResolvedValue([estado()]);

    render(<NumerosRemetentesPage />);
    await screen.findByRole('button', { name: 'Tentar novamente' });

    api.fetchNumerosRemetentes.mockResolvedValue([numero()]);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(screen.getAllByText('CDC Cohatrac').length).toBeGreaterThan(0));
  });
});

describe('NumerosRemetentesPage — lista', () => {
  it('mostra apelido, estado, badge de status e badge ativo/inativo', async () => {
    mockCargaBasica({ numeros: [numero({ ativo: true }), numero({ id: 4, apelido: 'Outro Número', ativo: false })] });

    await renderPage();

    expect(screen.getAllByText('CDC Cohatrac').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Outro Número').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aguardando conexão').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inativo').length).toBeGreaterThan(0);
  });
});

describe('NumerosRemetentesPage — criar número remetente', () => {
  it('validação: não chama a API quando apelido está vazio', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar número' }));

    expect(await screen.findByText('Campo "apelido" é obrigatório.')).toBeInTheDocument();
    expect(api.criarNumeroRemetente).not.toHaveBeenCalled();
  });

  it('validação: não chama a API quando nenhum estado foi selecionado', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.change(screen.getByLabelText('Apelido'), { target: { value: 'Novo número' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar número' }));

    expect(await screen.findByText('Selecione um estado.')).toBeInTheDocument();
    expect(api.criarNumeroRemetente).not.toHaveBeenCalled();
  });

  it('sucesso: cria o número, fecha o modal, mostra flash de sucesso e o número aparece na lista', async () => {
    mockCargaBasica({ numeros: [] });
    api.criarNumeroRemetente.mockResolvedValue(numero({ id: 9, apelido: 'Novo número' }));

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.change(screen.getByLabelText('Apelido'), { target: { value: 'Novo número' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar número' }));

    await waitFor(() => expect(api.criarNumeroRemetente).toHaveBeenCalledWith('token-teste', {
      apelido: 'Novo número', estadoId: 6,
    }));

    expect(await screen.findByText('Número remetente criado.')).toBeInTheDocument();
    expect(screen.getAllByText('Novo número').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Apelido')).not.toBeInTheDocument(); // modal fechado
  });

  it('erro da API é mostrado no formulário sem fechar o modal', async () => {
    mockCargaBasica();
    api.criarNumeroRemetente.mockRejectedValue(new Error('Erro simulado ao criar número'));

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.change(screen.getByLabelText('Apelido'), { target: { value: 'Novo número' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar número' }));

    expect(await screen.findByText('Erro simulado ao criar número')).toBeInTheDocument();
    expect(screen.getByLabelText('Apelido')).toBeInTheDocument(); // modal continua aberto
  });
});

describe('NumerosRemetentesPage — editar número remetente', () => {
  it('abre o modal pré-preenchido e envia só a atualização via PUT', async () => {
    mockCargaBasica();
    api.atualizarNumeroRemetente.mockResolvedValue(numero({ apelido: 'Apelido Editado' }));

    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    expect(screen.getByLabelText('Apelido')).toHaveValue('CDC Cohatrac');

    fireEvent.change(screen.getByLabelText('Apelido'), { target: { value: 'Apelido Editado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(api.atualizarNumeroRemetente).toHaveBeenCalledWith('token-teste', 3, {
      apelido: 'Apelido Editado', estadoId: 6,
    }));
    expect(await screen.findByText('Número remetente atualizado.')).toBeInTheDocument();
  });
});

describe('NumerosRemetentesPage — ativar/desativar', () => {
  it('clicar em "Desativar" chama PUT com { ativo: false } e mostra flash de sucesso', async () => {
    mockCargaBasica({ numeros: [numero({ ativo: true })] });
    api.atualizarNumeroRemetente.mockResolvedValue(numero({ ativo: false }));

    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0]);

    await waitFor(() => expect(api.atualizarNumeroRemetente).toHaveBeenCalledWith('token-teste', 3, { ativo: false }));
    expect(await screen.findByText('Número desativado.')).toBeInTheDocument();
  });

  it('se a promise rejeitar, mostra flash de erro e não altera o badge', async () => {
    mockCargaBasica({ numeros: [numero({ ativo: true })] });
    api.atualizarNumeroRemetente.mockRejectedValue(new Error('Falha simulada ao atualizar status'));

    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Desativar' })[0]);

    expect(await screen.findByText('Falha simulada ao atualizar status')).toBeInTheDocument();
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);
  });
});

describe('NumerosRemetentesPage — excluir', () => {
  it('confirmação cancelada (window.confirm false) não chama a API', async () => {
    mockCargaBasica();
    vi.stubGlobal('confirm', vi.fn(() => false));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir' })[0]);

    expect(api.removerNumeroRemetente).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sucesso: remove da lista e mostra flash de sucesso', async () => {
    mockCargaBasica();
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.removerNumeroRemetente.mockResolvedValue(undefined);

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir' })[0]);

    await waitFor(() => expect(api.removerNumeroRemetente).toHaveBeenCalledWith('token-teste', 3));
    expect(await screen.findByText('Número remetente excluído.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum número remetente cadastrado.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('conflito (409, número com vínculo): mostra flash de erro e mantém o item na lista', async () => {
    mockCargaBasica();
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.removerNumeroRemetente.mockRejectedValue(new Error(
      'Não é possível excluir este número pois existem contatos ou importações vinculadas a ele. Utilize a atualização (PUT) com ativo=false para desativá-lo.'
    ));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Excluir' })[0]);

    expect(await screen.findByText(/Não é possível excluir este número/)).toBeInTheDocument();
    expect(screen.getAllByText('CDC Cohatrac').length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

describe('NumerosRemetentesPage — cadastro inline de Estado novo', () => {
  it('validações do mini-formulário: nome vazio, uf inválida, ddds vazio', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Cadastrar novo estado' }));

    fireEvent.click(screen.getByRole('button', { name: 'Salvar estado' }));
    expect(await screen.findByText('Campo "nome" é obrigatório.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Nome (ex.: Maranhão)'), { target: { value: 'Bahia' } });
    fireEvent.change(screen.getByPlaceholderText('UF (ex.: MA)'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar estado' }));
    expect(await screen.findByText('Campo "uf" é obrigatório e deve ter 2 letras.')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('UF (ex.: MA)'), { target: { value: 'BA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar estado' }));
    expect(await screen.findByText('Informe ao menos um DDD válido.')).toBeInTheDocument();
    expect(api.criarEstado).not.toHaveBeenCalled();
  });

  it('sucesso: cria o estado, seleciona ele no dropdown principal e mostra flash', async () => {
    mockCargaBasica();
    api.criarEstado.mockResolvedValue({ id: 7, nome: 'Bahia', uf: 'BA', ddds: ['71'], criado_em: '2026-01-01T00:00:00.000Z' });

    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Cadastrar novo estado' }));

    fireEvent.change(screen.getByPlaceholderText('Nome (ex.: Maranhão)'), { target: { value: 'Bahia' } });
    fireEvent.change(screen.getByPlaceholderText('UF (ex.: MA)'), { target: { value: 'BA' } });
    fireEvent.change(screen.getByPlaceholderText('Ex.: 98'), { target: { value: '71' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Ex.: 98'), { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Salvar estado' }));

    await waitFor(() => expect(api.criarEstado).toHaveBeenCalledWith('token-teste', {
      nome: 'Bahia', uf: 'BA', ddds: ['71'],
    }));
    expect(await screen.findByText('Estado criado.')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toHaveValue('7');
  });
});
