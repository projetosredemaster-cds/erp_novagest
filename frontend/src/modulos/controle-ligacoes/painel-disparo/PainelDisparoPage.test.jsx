import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import PainelDisparoPage from './PainelDisparoPage.jsx';

vi.mock('./painelDisparoApi.js', () => ({
  fetchPainelDisparo: vi.fn(),
  fetchContatosDisponiveis: vi.fn(),
  verificarDisparo: vi.fn(),
  criarDisparo: vi.fn(),
}));

vi.mock('../configuracoes/controleLigacoesConfigApi.js', () => ({
  fetchNumerosRemetentes: vi.fn(),
}));

vi.mock('../../../app/AuthContext.jsx', () => ({
  useAuth: vi.fn(),
}));

import * as api from './painelDisparoApi.js';
import { fetchNumerosRemetentes } from '../configuracoes/controleLigacoesConfigApi.js';
import { useAuth } from '../../../app/AuthContext.jsx';

function numeroRemetenteDetalhado({ id = 3, statusConexao = 'conectado', nomeColaboradora = 'Ana Souza' } = {}) {
  return { id, apelido: 'CDC Cohatrac', numero: '5598900000000', statusConexao, nomeColaboradora, ativo: true, estado: { id: 6, nome: 'Maranhão', uf: 'MA' } };
}

function resumoMaranhao({ totalContatos = 2, numerosAtivos } = {}) {
  return {
    estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
    totalContatos,
    numerosAtivos: numerosAtivos ?? [
      { id: 3, apelido: 'CDC Cohatrac', statusConexao: 'conectado' },
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
  fetchNumerosRemetentes.mockResolvedValue([numeroRemetenteDetalhado()]);
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
    expect(screen.getByText('Conectado')).toBeInTheDocument();
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

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1);
  });

  it('regressão: debounce da busca na montagem não trava o card em "Carregando contatos..." mesmo sem interação do usuário', async () => {
    vi.useFakeTimers();
    try {
      mockCargaBasica();

      render(<PainelDisparoPage />);

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.queryByText('Carregando contatos...')).not.toBeInTheDocument();
      expect(screen.getByText('Maria Silva')).toBeInTheDocument();

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

    expect(screen.getByText('Maria Silva')).toBeInTheDocument();

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

describe('PainelDisparoPage — elegibilidade de número remetente para disparo', () => {
  it('número desconectado aparece desabilitado no select com sufixo "(desconectado)"', async () => {
    mockCargaBasica({
      painel: [resumoMaranhao({
        numerosAtivos: [{ id: 3, apelido: 'CDC Cohatrac', statusConexao: 'desconectado' }],
      })],
    });
    fetchNumerosRemetentes.mockResolvedValue([
      numeroRemetenteDetalhado({ statusConexao: 'desconectado' }),
    ]);

    await renderPage();

    expect(screen.getByRole('option', { name: 'CDC Cohatrac (desconectado)' })).toBeDisabled();
  });

  it('número conectado sem nome de colaboradora aparece desabilitado com sufixo "(sem colaboradora configurada)"', async () => {
    mockCargaBasica();
    fetchNumerosRemetentes.mockResolvedValue([
      numeroRemetenteDetalhado({ statusConexao: 'conectado', nomeColaboradora: '' }),
    ]);

    await renderPage();

    expect(screen.getByRole('option', { name: 'CDC Cohatrac (sem colaboradora configurada)' })).toBeDisabled();
  });

  it('nenhum número elegível: botão Disparar fica desabilitado mesmo com contato selecionado, e mostra aviso discreto', async () => {
    mockCargaBasica();
    fetchNumerosRemetentes.mockResolvedValue([
      numeroRemetenteDetalhado({ statusConexao: 'aguardando_conexao', nomeColaboradora: null }),
    ]);

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);

    expect(screen.getByText(
      'Nenhum número deste estado está pronto para disparo. Configure a conexão e o nome da colaboradora em Configurações.'
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disparar' })).toBeDisabled();
  });

  it('seleção inicial prefere um número elegível mesmo quando não é o primeiro da lista', async () => {
    mockCargaBasica({
      painel: [resumoMaranhao({
        numerosAtivos: [
          { id: 3, apelido: 'CDC Cohatrac', statusConexao: 'desconectado' },
          { id: 4, apelido: 'CDC Imperatriz', statusConexao: 'conectado' },
        ],
      })],
    });
    fetchNumerosRemetentes.mockResolvedValue([
      numeroRemetenteDetalhado({ id: 3, statusConexao: 'desconectado', nomeColaboradora: null }),
      numeroRemetenteDetalhado({ id: 4, statusConexao: 'conectado', nomeColaboradora: 'Bia' }),
    ]);

    await renderPage();

    expect(screen.getByLabelText('Número remetente usado neste disparo')).toHaveValue('4');
  });

  it('número selecionado elegível mostra a linha "📱 {numero} · Atendido por {nomeColaboradora}"', async () => {
    mockCargaBasica();

    await renderPage();

    expect(screen.getByText('📱 5598900000000 · Atendido por Ana Souza')).toBeInTheDocument();
  });

  it('número selecionado elegível mas sem `numero` (telefone) preenchido não mostra a linha nova', async () => {
    mockCargaBasica();
    fetchNumerosRemetentes.mockResolvedValue([
      { ...numeroRemetenteDetalhado(), numero: null },
    ]);

    await renderPage();

    expect(screen.queryByText(/Atendido por/)).not.toBeInTheDocument();
  });

  it('número selecionado inelegível não mostra a linha "Atendido por"', async () => {
    mockCargaBasica({
      painel: [resumoMaranhao({
        numerosAtivos: [{ id: 3, apelido: 'CDC Cohatrac', statusConexao: 'desconectado' }],
      })],
    });
    fetchNumerosRemetentes.mockResolvedValue([
      numeroRemetenteDetalhado({ statusConexao: 'desconectado' }),
    ]);

    await renderPage();

    expect(screen.queryByText(/Atendido por/)).not.toBeInTheDocument();
  });

  it('erro 400 do backend (validação de conexão/colaboradora) continua exibido verbatim no card, sem reescrita no frontend', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockRejectedValue(new Error(
      'Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar.'
    ));

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText(
      'Este número não está conectado ao WhatsApp. Conecte-o em Configurações antes de disparar.'
    )).toBeInTheDocument();
    expect(api.criarDisparo).not.toHaveBeenCalled();
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
  it('sucesso sem avisos: verifica, cria automaticamente sem segundo clique, mostra flash, limpa seleção e recarrega contatos', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockResolvedValue({ avisos: [] });
    api.criarDisparo.mockResolvedValue({ disparoId: 42, totalContatos: 1 });

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    api.fetchContatosDisponiveis.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    await waitFor(() => expect(api.verificarDisparo).toHaveBeenCalledWith('token-teste', {
      estadoId: 6, numeroRemetenteId: 3, contatoIds: [10],
    }));
    await waitFor(() => expect(api.criarDisparo).toHaveBeenCalledWith('token-teste', {
      estadoId: 6, numeroRemetenteId: 3, contatoIds: [10],
    }));

    expect(await screen.findByText('Disparo registrado.')).toBeInTheDocument();
    expect(screen.getByText('0/10 selecionados')).toBeInTheDocument();
    expect(screen.queryByText('Aviso antes de disparar')).not.toBeInTheDocument();
    await waitFor(() => expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1));
  });

  it('com avisos + "Cancelar": não chama POST /disparos, não fecha com gravação e mantém a seleção', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockResolvedValue({
      avisos: [{ contatoId: 11, nome: 'João Souza', telefone: '5598900000001' }],
    });

    await renderPage();

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // João Souza (id 11)
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Aviso antes de disparar')).toBeInTheDocument();
    expect(screen.getByText(/já foram contatados nos últimos 3 dias/)).toBeInTheDocument();
    expect(screen.getAllByText('João Souza').length).toBeGreaterThan(0);
    expect(api.criarDisparo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByText('Aviso antes de disparar')).not.toBeInTheDocument());
    expect(api.criarDisparo).not.toHaveBeenCalled();
    expect(screen.getByText('1/10 selecionados')).toBeInTheDocument();
    expect(checkboxes[1]).toBeChecked();
  });

  it('com avisos + "Disparar mesmo assim": chama POST /disparos, fecha modal, limpa seleção, mostra flash e recarrega contatos', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockResolvedValue({
      avisos: [{ contatoId: 11, nome: 'João Souza', telefone: '5598900000001' }],
    });
    api.criarDisparo.mockResolvedValue({ disparoId: 42, totalContatos: 1 });

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Aviso antes de disparar')).toBeInTheDocument();

    api.fetchContatosDisponiveis.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Disparar mesmo assim' }));

    await waitFor(() => expect(api.criarDisparo).toHaveBeenCalledWith('token-teste', {
      estadoId: 6, numeroRemetenteId: 3, contatoIds: [11],
    }));

    await waitFor(() => expect(screen.queryByText('Aviso antes de disparar')).not.toBeInTheDocument());
    expect(await screen.findByText('Disparo registrado.')).toBeInTheDocument();
    expect(screen.getByText('0/10 selecionados')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchContatosDisponiveis).toHaveBeenCalledTimes(1));
  });

  it('erro na verificação é mostrado no card sem gravar nada', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockRejectedValue(new Error('Número remetente inválido para o estado informado.'));

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Número remetente inválido para o estado informado.')).toBeInTheDocument();
    expect(api.criarDisparo).not.toHaveBeenCalled();
  });

  it('erro ao confirmar "Disparar mesmo assim" mantém o modal aberto com feedback de erro', async () => {
    mockCargaBasica();
    api.verificarDisparo.mockResolvedValue({
      avisos: [{ contatoId: 11, nome: 'João Souza', telefone: '5598900000001' }],
    });
    api.criarDisparo.mockRejectedValue(new Error('Erro ao registrar disparo.'));

    await renderPage();

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Disparar' }));

    expect(await screen.findByText('Aviso antes de disparar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disparar mesmo assim' }));

    expect(await screen.findByText('Erro ao registrar disparo.')).toBeInTheDocument();
    expect(screen.getByText('Aviso antes de disparar')).toBeInTheDocument();
    expect(screen.getByText('1/10 selecionados')).toBeInTheDocument();
  });
});
