import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PainelDisparoPage from './PainelDisparoPage.jsx';

vi.mock('./painelDisparoApi.js', () => ({
  fetchPainelDisparo: vi.fn(),
  fetchContatosDisponiveis: vi.fn(),
  criarDisparo: vi.fn(),
}));

vi.mock('../../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as api from './painelDisparoApi.js';
import { useAuth } from '../../../app/AuthContext.jsx';

function resumoMaranhao({ totalContatos = 2, numerosAtivos } = {}) {
  return {
    estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
    totalContatos,
    numerosAtivos: numerosAtivos ?? [
      { id: 3, apelido: 'CDC Cohatrac', statusConexao: 'aguardando_conexao' },
    ],
  };
}

function contato({ id, nome, telefone, disparadoUltimos3Dias = false }) {
  return { id, nome, telefone, disparadoUltimos3Dias };
}

function mockCargaBasica({ painel, contatos } = {}) {
  api.fetchPainelDisparo.mockResolvedValue(painel ?? [resumoMaranhao()]);
  api.fetchContatosDisponiveis.mockResolvedValue(contatos ?? [
    contato({ id: 10, nome: 'Maria Silva', telefone: '5598900000000' }),
    contato({ id: 11, nome: 'João Souza', telefone: '5598900000001', disparadoUltimos3Dias: true }),
  ]);
}

async function renderPage() {
  const utils = render(<PainelDisparoPage />);
  await waitFor(() => expect(screen.queryAllByText('Carregando...')).toHaveLength(0));
  await waitFor(() => expect(screen.queryAllByText('Carregando contatos...')).toHaveLength(0));
  return utils;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
});

describe('PainelDisparoPage — estados de loading/erro/vazio do painel', () => {
  it('loading: mostra "Carregando..." enquanto o painel não resolve', async () => {
    api.fetchPainelDisparo.mockReturnValue(new Promise(() => {}));

    render(<PainelDisparoPage />);

    expect(await screen.findByText('Carregando...')).toBeInTheDocument();
  });

  it('erro: fetchPainelDisparo rejeitado mostra mensagem e botão "Tentar novamente"', async () => {
    api.fetchPainelDisparo.mockRejectedValue(new Error('Falha ao buscar painel'));

    render(<PainelDisparoPage />);

    expect(await screen.findByText(/Não foi possível carregar o painel de disparo: Falha ao buscar painel/))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('vazio: nenhum estado cadastrado mostra a mensagem de estado vazio', async () => {
    api.fetchPainelDisparo.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByText('Nenhum estado cadastrado.')).toBeInTheDocument();
  });
});

describe('PainelDisparoPage — card de estado', () => {
  it('mostra nome do estado, total de contatos, número ativo e badge de status', async () => {
    mockCargaBasica();

    await renderPage();

    expect(screen.getByText('Maranhão')).toBeInTheDocument();
    expect(screen.getByText('2 contato(s) disponível(is)')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'CDC Cohatrac' })).toBeInTheDocument();
    expect(screen.getByText('Aguardando conexão')).toBeInTheDocument();
  });

  it('estado sem número ativo: mostra aviso e botão Disparar desabilitado', async () => {
    mockCargaBasica({ painel: [resumoMaranhao({ numerosAtivos: [] })] });

    await renderPage();

    expect(screen.getByText('Nenhum número remetente ativo cadastrado para este estado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disparar' })).toBeDisabled();
  });

  it('lista os contatos do estado com badge de "Contatado há menos de 3 dias" quando aplicável', async () => {
    mockCargaBasica();

    await renderPage();

    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('João Souza')).toBeInTheDocument();
    expect(screen.getByText('Contatado há menos de 3 dias')).toBeInTheDocument();
  });

  it('vazio: nenhum contato disponível mostra mensagem, não card quebrado', async () => {
    mockCargaBasica({ contatos: [] });

    await renderPage();

    expect(screen.getByText('Nenhum contato disponível neste estado.')).toBeInTheDocument();
  });

  it('erro: fetchContatosDisponiveis rejeitado sai do "Carregando contatos..." e mostra "Tentar novamente" que refaz só a chamada do card', async () => {
    mockCargaBasica();
    api.fetchContatosDisponiveis.mockRejectedValueOnce(new Error('Falha ao buscar contatos.'));

    await renderPage();

    expect(screen.queryByText('Carregando contatos...')).not.toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar os contatos deste estado.')).toBeInTheDocument();

    api.fetchContatosDisponiveis.mockClear();
    api.fetchContatosDisponiveis.mockResolvedValue([
      contato({ id: 10, nome: 'Maria Silva', telefone: '5598900000000' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());
    expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1);
  });

  it('resposta não-2xx sem corpo parseável (ex.: 304) não trava o card em "Carregando..." nem quebra a tela', async () => {
    mockCargaBasica();
    // simula o que apiClient.js faz para uma resposta !response.ok sem JSON no corpo
    api.fetchContatosDisponiveis.mockRejectedValueOnce(new Error('Erro ao comunicar com o servidor (304).'));

    await renderPage();

    expect(screen.queryByText('Carregando contatos...')).not.toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar os contatos deste estado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('não entra em loop de chamadas: cada card dispara fetchContatosDisponiveis exatamente uma vez por carregamento, sem interação do usuário', async () => {
    mockCargaBasica();

    await renderPage();

    expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1);

    // Aguarda mais tempo do que o debounce (400ms) sem nenhuma interação —
    // se houvesse um efeito com dependência instável, novas chamadas
    // apareceriam aqui sem nenhum gatilho do usuário.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1);
  });

  it('regressão: debounce da busca na montagem não trava o card em "Carregando contatos..." mesmo sem interação do usuário', async () => {
    vi.useFakeTimers();
    try {
      mockCargaBasica();

      render(<PainelDisparoPage />);

      // Flush das promessas de fetchPainelDisparo/fetchContatosDisponiveis
      // disparadas na montagem — nenhuma delas depende de timer, só de
      // microtasks das Promises já resolvidas pelo mock.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByText('Carregando contatos...')).not.toBeInTheDocument();
      expect(screen.getByText('Maria Silva')).toBeInTheDocument();

      // Avança o timer do debounce (400ms) além do limite, sem nenhuma
      // interação do usuário no campo de busca. No bug original, o efeito
      // de debounce roda também na montagem (buscaInput já começa em ''),
      // e o timer força setLoadingContatos(true) incondicionalmente; como
      // `busca` não muda de valor de verdade, nenhum novo fetch é
      // disparado e o card fica travado em "Carregando contatos..." para
      // sempre.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });

      expect(screen.queryByText('Carregando contatos...')).not.toBeInTheDocument();
      expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cards de estados diferentes têm estado de carregamento/erro/sucesso independentes entre si', async () => {
    const resumoRondonia = {
      estado: { id: 1, nome: 'Rondônia', uf: 'RO' },
      totalContatos: 0,
      numerosAtivos: [],
    };
    api.fetchPainelDisparo.mockResolvedValue([resumoMaranhao(), resumoRondonia]);
    api.fetchContatosDisponiveis.mockImplementation((_token, estadoId) => {
      if (estadoId === 6) {
        return Promise.resolve([contato({ id: 10, nome: 'Maria Silva', telefone: '5598900000000' })]);
      }
      return Promise.reject(new Error('Falha ao buscar contatos de Rondônia'));
    });

    await renderPage();

    // Card de Maranhão carregou com sucesso.
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();

    // Card de Rondônia, em paralelo, mostra seu próprio erro sem afetar o de Maranhão.
    expect(await screen.findByText('Não foi possível carregar os contatos deste estado.'))
      .toBeInTheDocument();
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
  });

  it('busca com debounce chama fetchContatosDisponiveis com o termo digitado', async () => {
    mockCargaBasica();
    await renderPage();

    api.fetchContatosDisponiveis.mockClear();
    fireEvent.change(screen.getByLabelText('Buscar contatos de Maranhão'), { target: { value: 'Maria' } });

    await waitFor(() => expect(api.fetchContatosDisponiveis).toHaveBeenCalledWith(
      'token-teste', 6, { busca: 'Maria', ordem: 'nome_asc' }
    ), { timeout: 1500 });
  });

  it('trocar ordenação chama fetchContatosDisponiveis com a nova ordem', async () => {
    mockCargaBasica();
    await renderPage();

    api.fetchContatosDisponiveis.mockClear();
    fireEvent.change(screen.getByLabelText('Ordenar contatos de Maranhão'), { target: { value: 'recentes' } });

    await waitFor(() => expect(api.fetchContatosDisponiveis).toHaveBeenCalledWith(
      'token-teste', 6, { busca: '', ordem: 'recentes' }
    ));
  });
});

describe('PainelDisparoPage — seleção de contatos (limite de 10)', () => {
  it('bloqueia a seleção do 11º contato e mostra mensagem, sem chamar a API', async () => {
    const contatos = Array.from({ length: 11 }, (_, i) => contato({ id: i + 1, nome: `Contato ${i + 1}`, telefone: `55989000000${i}` }));
    mockCargaBasica({ contatos });

    await renderPage();

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.slice(0, 10).forEach((cb) => fireEvent.click(cb));

    expect(screen.getByText('10/10 selecionados')).toBeInTheDocument();

    fireEvent.click(checkboxes[10]);

    expect(await screen.findByText('Máximo de 10 contatos por disparo.')).toBeInTheDocument();
    expect(checkboxes[10]).not.toBeChecked();
    expect(screen.getByText('10/10 selecionados')).toBeInTheDocument();
  });
});

describe('PainelDisparoPage — disparo', () => {
  it('sucesso sem avisos: chama POST /disparos, mostra flash e limpa a seleção', async () => {
    mockCargaBasica();
    api.criarDisparo.mockResolvedValue({ disparoId: 42, totalContatos: 1, avisos: [] });

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    await waitFor(() => expect(api.criarDisparo).toHaveBeenCalledWith('token-teste', {
      estadoId: 6, numeroRemetenteId: 3, contatoIds: [10],
    }));

    expect(await screen.findByText('Disparo registrado.')).toBeInTheDocument();
    expect(screen.getByText('0/10 selecionados')).toBeInTheDocument();
  });

  it('sucesso com avisos: abre modal informativo e não bloqueia (disparo já criado)', async () => {
    mockCargaBasica();
    api.criarDisparo.mockResolvedValue({
      disparoId: 42,
      totalContatos: 1,
      avisos: [{ id: 11, nome: 'João Souza', telefone: '5598900000001' }],
    });

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Disparo registrado com avisos')).toBeInTheDocument();
    expect(screen.getByText(/já foi registrado/)).toBeInTheDocument();
    expect(screen.getAllByText('João Souza').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));

    await waitFor(() => expect(screen.queryByText('Disparo registrado com avisos')).not.toBeInTheDocument());
    expect(screen.getByText('0/10 selecionados')).toBeInTheDocument();
  });

  it('erro da API é mostrado no card sem travar a tela', async () => {
    mockCargaBasica();
    api.criarDisparo.mockRejectedValue(new Error('Número remetente inválido para o estado informado.'));

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Número remetente inválido para o estado informado.')).toBeInTheDocument();
  });
});
