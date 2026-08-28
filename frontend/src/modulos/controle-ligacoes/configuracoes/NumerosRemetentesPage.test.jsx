import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import NumerosRemetentesPage from './NumerosRemetentesPage.jsx';


vi.mock('./controleLigacoesConfigApi.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchEstados: vi.fn(),
    criarEstado: vi.fn(),
    fetchNumerosRemetentes: vi.fn(),
    criarNumeroRemetente: vi.fn(),
    atualizarNumeroRemetente: vi.fn(),
    removerNumeroRemetente: vi.fn(),
    desconectarNumeroRemetente: vi.fn(),
  };
});

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr-value">{value}</div>,
}));

vi.mock('../../../app/useAuth.js', () => ({
  useAuth: vi.fn(),
}));

import * as api from './controleLigacoesConfigApi.js';
import { useAuth } from '../../../app/useAuth.js';

function numero({
  id = 3,
  apelido = 'CDC Cohatrac',
  ativo = true,
  estado,
  statusConexao = 'aguardando_conexao',
  numeroTelefone = null,
  nomeColaboradora = null,
} = {}) {
  return {
    id,
    apelido,
    numero: numeroTelefone,
    statusConexao,
    ativo,
    estado: estado || { id: 6, nome: 'Maranhão', uf: 'MA' },
    nomeColaboradora,
    criado_em: '2026-01-01T00:00:00.000Z',
  };
}

function sseChunk(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function makeStreamResponse(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok,
    status,
    json: () => Promise.resolve(null),
    body: {
      getReader: () => ({
        read: () => {
          if (index >= chunks.length) return Promise.resolve({ done: true, value: undefined });
          const chunk = chunks[index];
          index += 1;
          const text = typeof chunk === 'string' ? chunk : chunk.text;
          const delayMs = typeof chunk === 'string' ? 0 : (chunk.delayMs || 0);
          const value = encoder.encode(text);
          if (!delayMs) return Promise.resolve({ done: false, value });
          return new Promise((resolve) => setTimeout(() => resolve({ done: false, value }), delayMs));
        },
        cancel: () => Promise.resolve(),
      }),
    },
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
      apelido: 'Apelido Editado', estadoId: 6, nomeColaboradora: null,
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

describe('NumerosRemetentesPage — campo "Nome da colaboradora"', () => {
  it('fica desabilitado e vazio ao criar um número novo', async () => {
    mockCargaBasica();
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: '+ Novo número remetente' }));

    const campo = screen.getByLabelText('Nome da colaboradora (opcional)');
    expect(campo).toBeDisabled();
    expect(campo).toHaveValue('');
  });

  it('aparece pré-preenchido na edição e é enviado no PUT', async () => {
    mockCargaBasica({ numeros: [numero({ nomeColaboradora: 'Maria' })] });
    api.atualizarNumeroRemetente.mockResolvedValue(numero({ nomeColaboradora: 'Maria Silva' }));

    await renderPage();

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    const campo = screen.getByLabelText('Nome da colaboradora (opcional)');
    expect(campo).not.toBeDisabled();
    expect(campo).toHaveValue('Maria');

    fireEvent.change(campo, { target: { value: 'Maria Silva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(api.atualizarNumeroRemetente).toHaveBeenCalledWith('token-teste', 3, {
      apelido: 'CDC Cohatrac', estadoId: 6, nomeColaboradora: 'Maria Silva',
    }));
  });
});

describe('NumerosRemetentesPage — conexão WhatsApp (QR Code / SSE)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('abre o modal e mostra o QR ao receber o evento "qr"', async () => {
    mockCargaBasica();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([sseChunk('qr', { qr: 'QR-CODE-1' })])
    ));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);

    expect(await screen.findByRole('dialog', { name: 'Conectar WhatsApp' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('QR-CODE-1'));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/controle-ligacoes/numeros-remetentes/3/conexao/stream'),
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-teste' },
      })
    );
  });

  it('atualiza o QR exibido ao receber um novo evento "qr"', async () => {
    mockCargaBasica();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([
        sseChunk('qr', { qr: 'QR-1' }),
        { text: sseChunk('qr', { qr: 'QR-2' }), delayMs: 30 },
      ])
    ));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);

    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('QR-1'));
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('QR-2'));
  });

  it('fecha o modal, rebusca a lista e mostra flash de sucesso ao receber "conectado"', async () => {
    mockCargaBasica();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([sseChunk('conectado', { numero: '5598999999999' })])
    ));

    await renderPage();
    expect(api.fetchNumerosRemetentes).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);
    await screen.findByRole('dialog', { name: 'Conectar WhatsApp' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Conectar WhatsApp' })).not.toBeInTheDocument());
    expect(await screen.findByText('WhatsApp conectado com sucesso.')).toBeInTheDocument();
    expect(api.fetchNumerosRemetentes).toHaveBeenCalledTimes(2);
  });

  it('trata "ja_conectado" da mesma forma que "conectado"', async () => {
    mockCargaBasica();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([sseChunk('ja_conectado', { numero: '5598999999999' })])
    ));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);

    expect(await screen.findByText('WhatsApp conectado com sucesso.')).toBeInTheDocument();
  });

  it('mostra erro e permite "Tentar novamente", reabrindo o stream', async () => {
    mockCargaBasica();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeStreamResponse([sseChunk('erro', { mensagem: 'Falha simulada de conexão' })]))
      .mockResolvedValueOnce(makeStreamResponse([sseChunk('qr', { qr: 'QR-RETRY' })]));
    vi.stubGlobal('fetch', fetchMock);

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);

    expect(await screen.findByText('Falha simulada de conexão')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('QR-RETRY'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fechar o modal cancela a leitura do stream (aborta o fetch)', async () => {
    mockCargaBasica();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeStreamResponse([sseChunk('qr', { qr: 'QR-1' })])
    ));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Conectar WhatsApp' })[0]);
    await waitFor(() => expect(screen.getByTestId('qr-value')).toHaveTextContent('QR-1'));

    // "Fechar" tem duas ocorrências no modal (botão "✕" com aria-label
    // "Fechar" e o botão de rodapé "Fechar") — usa a última (rodapé).
    const botoesFechar = screen.getAllByRole('button', { name: 'Fechar' });
    fireEvent.click(botoesFechar[botoesFechar.length - 1]);

    expect(screen.queryByRole('dialog', { name: 'Conectar WhatsApp' })).not.toBeInTheDocument();
    const [, options] = fetch.mock.calls[0];
    expect(options.signal.aborted).toBe(true);
  });

  it('para número já conectado, mostra "Desconectar" e confirma antes de chamar a rota', async () => {
    mockCargaBasica({ numeros: [numero({ statusConexao: 'conectado', numeroTelefone: '5598999999999' })] });
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.desconectarNumeroRemetente.mockResolvedValue(
      numero({ statusConexao: 'aguardando_conexao', numeroTelefone: null })
    );

    await renderPage();

    expect(screen.queryAllByRole('button', { name: 'Conectar WhatsApp' })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Desconectar' })[0]);

    expect(confirm).toHaveBeenCalledWith(
      'Isso encerrará a sessão do WhatsApp. Será necessário escanear o QR novamente para reconectar. Continuar?'
    );
    await waitFor(() => expect(api.desconectarNumeroRemetente).toHaveBeenCalledWith('token-teste', 3));
    expect(await screen.findByText('WhatsApp desconectado.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Conectar WhatsApp' }).length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it('confirmação cancelada ao desconectar não chama a rota', async () => {
    mockCargaBasica({ numeros: [numero({ statusConexao: 'conectado', numeroTelefone: '5598999999999' })] });
    vi.stubGlobal('confirm', vi.fn(() => false));

    await renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Desconectar' })[0]);

    expect(api.desconectarNumeroRemetente).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
