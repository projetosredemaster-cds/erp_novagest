import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FalhasEnvioPage from './FalhasEnvioPage.jsx';

vi.mock('./falhasEnvioApi.js', () => ({
  fetchFalhasEnvio: vi.fn(),
  reenviarDisparoContato: vi.fn(),
  ignorarDisparoContato: vi.fn(),
}));

vi.mock('../../../app/useAuth.js', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useOutletContext: vi.fn(),
}));

import { fetchFalhasEnvio, reenviarDisparoContato, ignorarDisparoContato } from './falhasEnvioApi.js';
import { useAuth } from '../../../app/useAuth.js';
import { useOutletContext } from 'react-router-dom';

function falha({
  disparoContatoId = 42,
  nome = 'Maria Silva',
  telefone = '5598900000000',
  estado = { id: 6, nome: 'Maranhão', uf: 'MA' },
  numeroRemetente = { id: 3, apelido: 'CDC Cohatrac' },
  erro = 'Número não possui WhatsApp ativo ou não pôde ser verificado.',
  tentadoEm = null,
  criadoEm = '2026-09-08T14:03:11.000Z',
} = {}) {
  return { disparoContatoId, nome, telefone, estado, numeroRemetente, erro, tentadoEm, criadoEm };
}

beforeEach(() => {
  vi.resetAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
  useOutletContext.mockReturnValue(undefined);
});

describe('FalhasEnvioPage', () => {
  it('estado de carregamento: mostra "Carregando..." antes do fetch resolver', () => {
    fetchFalhasEnvio.mockReturnValue(new Promise(() => {}));

    render(<FalhasEnvioPage />);

    expect(screen.getByText('Carregando...')).toBeInTheDocument();
  });

  it('estado de erro: mostra a mensagem quando o fetch falha', async () => {
    fetchFalhasEnvio.mockRejectedValue(new Error('Erro ao comunicar com o servidor (500).'));

    render(<FalhasEnvioPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/Não foi possível carregar as falhas de envio/)
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/Erro ao comunicar com o servidor \(500\)\./)).toBeInTheDocument();
  });

  it('estado vazio: mostra mensagem quando não há falhas', async () => {
    fetchFalhasEnvio.mockResolvedValue([]);

    render(<FalhasEnvioPage />);

    await waitFor(() =>
      expect(screen.getByText('Nenhuma falha de envio no momento.')).toBeInTheDocument()
    );
  });

  it('clique em "Ignorar" chama a API e remove a linha da lista local em sucesso, sem refetch', async () => {
    fetchFalhasEnvio.mockResolvedValue([falha({ disparoContatoId: 42, nome: 'Maria Silva' })]);
    ignorarDisparoContato.mockResolvedValue(null); // 204 sem corpo -> apiRequest resolve com null

    render(<FalhasEnvioPage />);

    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Ignorar' }));

    await waitFor(() =>
      expect(screen.getByText('Nenhuma falha de envio no momento.')).toBeInTheDocument()
    );

    expect(ignorarDisparoContato).toHaveBeenCalledWith('token-teste', 42);
    // Removeu localmente, sem um segundo fetchFalhasEnvio (só o do mount inicial).
    expect(fetchFalhasEnvio).toHaveBeenCalledTimes(1);
  });

  it('erro ao ignorar: mantém a linha e mostra a mensagem de erro inline, sem afetar outras linhas', async () => {
    fetchFalhasEnvio.mockResolvedValue([
      falha({ disparoContatoId: 42, nome: 'Maria Silva' }),
      falha({ disparoContatoId: 43, nome: 'João Souza', telefone: '5598900000001' }),
    ]);
    ignorarDisparoContato.mockRejectedValue(new Error('Erro ao comunicar com o servidor (500).'));

    render(<FalhasEnvioPage />);

    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());

    const botoesIgnorar = screen.getAllByRole('button', { name: 'Ignorar' });
    fireEvent.click(botoesIgnorar[0]);

    await waitFor(() =>
      expect(screen.getByText('Erro ao comunicar com o servidor (500).')).toBeInTheDocument()
    );

    // As duas linhas continuam presentes — nada foi removido em caso de erro.
    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('João Souza')).toBeInTheDocument();
  });

  it('durante "Ignorar" em progresso, os botões "Reenviar" e "Ignorar" daquela linha ficam desabilitados', async () => {
    fetchFalhasEnvio.mockResolvedValue([falha({ disparoContatoId: 42, nome: 'Maria Silva' })]);
    let resolverIgnorar;
    ignorarDisparoContato.mockReturnValue(
      new Promise((resolve) => {
        resolverIgnorar = resolve;
      })
    );

    render(<FalhasEnvioPage />);

    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Ignorar' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ignorando...' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Reenviar' })).toBeDisabled();

    resolverIgnorar(null);
    await waitFor(() =>
      expect(screen.getByText('Nenhuma falha de envio no momento.')).toBeInTheDocument()
    );
  });

  it('reenviar continua funcionando normalmente (sem regressão introduzida pelo botão Ignorar)', async () => {
    fetchFalhasEnvio.mockResolvedValue([falha({ disparoContatoId: 42, nome: 'Maria Silva' })]);
    reenviarDisparoContato.mockResolvedValue({ status: 'enviado' });

    render(<FalhasEnvioPage />);

    await waitFor(() => expect(screen.getByText('Maria Silva')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Reenviar' }));

    await waitFor(() =>
      expect(screen.getByText('Nenhuma falha de envio no momento.')).toBeInTheDocument()
    );
    expect(reenviarDisparoContato).toHaveBeenCalledWith('token-teste', 42);
    expect(ignorarDisparoContato).not.toHaveBeenCalled();
  });
});
