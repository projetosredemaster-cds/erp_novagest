import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ConversasPage from './ConversasPage.jsx';

vi.mock('./conversasApi.js', () => ({
  fetchConversas: vi.fn(),
  fetchMensagens: vi.fn(),
  enviarMensagem: vi.fn(),
  abrirStreamConversas: vi.fn(),
  fetchAudioMensagemUrl: vi.fn(),
}));

vi.mock('../../../app/useAuth.js', () => ({
  useAuth: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useOutletContext: vi.fn(),
  useLocation: vi.fn(),
  useNavigate: vi.fn(),
}));

import * as api from './conversasApi.js';
import { useAuth } from '../../../app/useAuth.js';
import { useOutletContext, useLocation, useNavigate } from 'react-router-dom';

function conversa({
  id = 42,
  nome = 'Maria Silva',
  telefone = '5598900000000',
  ultimaMensagemCorpo = 'Oi, tudo bem?',
  remetente = 'cliente',
  naoLidas = 0,
  numeroRemetenteAtual = { id: 3, apelido: 'Teste Junior' },
  numeroRemetenteInicial = { id: 3, apelido: 'Teste Junior' },
} = {}) {
  return {
    contato: { id, nome, telefone },
    numeroRemetenteAtual,
    numeroRemetenteInicial,
    ultimaMensagem: { corpo: ultimaMensagemCorpo, remetente, criado_em: '2026-08-25T12:00:00.000Z' },
    naoLidas,
  };
}

function mensagensResposta({ mensagens = [] } = {}) {
  return { mensagens };
}

async function renderPage() {
  const utils = render(<ConversasPage />);
  await waitFor(() => expect(screen.queryByText('Carregando...')).not.toBeInTheDocument());
  return utils;
}

const navigateMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ token: 'token-teste' });
  useOutletContext.mockReturnValue(undefined);
  useLocation.mockReturnValue({ pathname: '/controle-ligacoes/conversas', state: null });
  useNavigate.mockReturnValue(navigateMock);
  api.abrirStreamConversas.mockImplementation(() => new Promise(() => {}));
  api.fetchAudioMensagemUrl.mockResolvedValue('blob:fake-url');
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('ConversasPage — lista de conversas', () => {
  it('carrega e renderiza os itens da lista', async () => {
    api.fetchConversas.mockResolvedValue([
      conversa(),
      conversa({ id: 43, nome: 'João Souza', telefone: '5598900000001', naoLidas: 2 }),
    ]);

    await renderPage();

    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.getByText('João Souza')).toBeInTheDocument();
    expect(screen.getAllByText('Oi, tudo bem?').length).toBe(2);
    expect(screen.getByText('2')).toBeInTheDocument(); // badge de não lidas
  });

  it('estado vazio: mostra "Nenhuma conversa ainda."', async () => {
    api.fetchConversas.mockResolvedValue([]);

    await renderPage();

    expect(screen.getByText('Nenhuma conversa ainda.')).toBeInTheDocument();
  });

  it('erro: mostra mensagem e botão "Tentar novamente"', async () => {
    api.fetchConversas.mockRejectedValue(new Error('Falha ao buscar conversas'));

    await renderPage();

    expect(screen.getByText(/Não foi possível carregar as conversas: Falha ao buscar conversas/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

describe('ConversasPage — painel de chat', () => {
  it('estado vazio inicial convida a selecionar uma conversa', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);

    await renderPage();

    expect(screen.getByText('Selecione uma conversa na lista ao lado para visualizar o histórico.')).toBeInTheDocument();
  });

  it('clicar num item carrega e renderiza o histórico, zerando não lidas localmente', async () => {
    api.fetchConversas.mockResolvedValue([conversa({ naoLidas: 2 })]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
        { id: 2, remetente: 'ia', corpo: 'Olá! Como posso ajudar?', criado_em: '2026-08-25T12:01:00.000Z' },
      ],
    }));

    await renderPage();

    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 3));
    expect(await screen.findByText('Olá! Como posso ajudar?')).toBeInTheDocument();
    expect(screen.getAllByText('Oi, tudo bem?').length).toBeGreaterThan(0);

    // badge de não lidas some do item da lista após abrir a conversa
    await waitFor(() => expect(screen.queryByText('2')).not.toBeInTheDocument());
  });

  it('trocar entre duas conversas do mesmo contato (números remetentes diferentes) sempre recarrega as mensagens e move o destaque visual', async () => {
    const conversaBruno = conversa({
      numeroRemetenteAtual: { id: 3, apelido: 'Bruno' },
      numeroRemetenteInicial: { id: 3, apelido: 'Bruno' },
    });
    const conversaLivia = conversa({
      numeroRemetenteAtual: { id: 9, apelido: 'Livia' },
      numeroRemetenteInicial: { id: 9, apelido: 'Livia' },
    });
    api.fetchConversas.mockResolvedValue([conversaBruno, conversaLivia]);
    api.fetchMensagens
      .mockResolvedValueOnce(mensagensResposta({
        mensagens: [{ id: 1, remetente: 'cliente', corpo: 'Mensagem via Bruno', criado_em: '2026-08-25T12:00:00.000Z' }],
      }))
      .mockResolvedValueOnce(mensagensResposta({
        mensagens: [{ id: 2, remetente: 'cliente', corpo: 'Mensagem via Livia', criado_em: '2026-08-25T12:01:00.000Z' }],
      }));

    await renderPage();

    const botaoBruno = screen.getByText('via Bruno').closest('button');
    const botaoLivia = screen.getByText('via Livia').closest('button');

    fireEvent.click(botaoBruno);
    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 3));
    expect(await screen.findByText('Mensagem via Bruno')).toBeInTheDocument();
    expect(botaoBruno).toHaveAttribute('aria-pressed', 'true');
    expect(botaoLivia).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(botaoLivia);
    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 9));
    expect(await screen.findByText('Mensagem via Livia')).toBeInTheDocument();
    expect(botaoBruno).toHaveAttribute('aria-pressed', 'false');
    expect(botaoLivia).toHaveAttribute('aria-pressed', 'true');
    expect(api.fetchMensagens).toHaveBeenCalledTimes(2);
  });

  it('envio de mensagem com sucesso aparece no chat e limpa o campo', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    api.enviarMensagem.mockResolvedValue({
      id: 2, remetente: 'colaboradora', corpo: 'Oi Maria, tudo ótimo!', criado_em: '2026-08-25T12:05:00.000Z',
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const textarea = screen.getByLabelText('Mensagem para o contato');
    fireEvent.change(textarea, { target: { value: 'Oi Maria, tudo ótimo!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(api.enviarMensagem).toHaveBeenCalledWith('token-teste', 42, 3, 'Oi Maria, tudo ótimo!'));
    expect(await screen.findByText('Oi Maria, tudo ótimo!')).toBeInTheDocument();
    expect(textarea).toHaveValue('');
  });

  it('erro 409 ao enviar mostra a mensagem de número desconectado e preserva o texto digitado', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    api.enviarMensagem.mockRejectedValue(new Error('Número não está conectado.'));

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const textarea = screen.getByLabelText('Mensagem para o contato');
    fireEvent.change(textarea, { target: { value: 'Oi Maria!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText(
      'O número usado nesta conversa está desconectado. Reconecte-o em Configurações antes de responder.'
    )).toBeInTheDocument();
    expect(textarea).toHaveValue('Oi Maria!');
  });
});

describe('ConversasPage — mensagens de áudio', () => {
  it('mensagem com tipo_mensagem "audio" e corpo normal renderiza um player de áudio', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 3, remetente: 'cliente', corpo: '[Áudio]', criado_em: '2026-08-25T12:02:00.000Z', tipo_mensagem: 'audio' },
      ],
    }));

    const { container } = await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => expect(api.fetchAudioMensagemUrl).toHaveBeenCalledWith('token-teste', 3));
    await waitFor(() => expect(container.querySelector('audio')).toBeInTheDocument());
    expect(screen.queryByText('[Áudio]')).not.toBeInTheDocument();
  });

  it('mensagem de áudio indisponível renderiza o texto normalmente, sem player', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 4, remetente: 'cliente', corpo: '[Áudio indisponível]', criado_em: '2026-08-25T12:02:00.000Z', tipo_mensagem: 'audio' },
      ],
    }));

    const { container } = await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    expect(await screen.findByText('[Áudio indisponível]')).toBeInTheDocument();
    expect(container.querySelector('audio')).not.toBeInTheDocument();
    expect(api.fetchAudioMensagemUrl).not.toHaveBeenCalled();
  });

  it('mensagem de texto (sem tipo_mensagem) continua sem player de áudio', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    const { container } = await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    await screen.findByText('Oi, tudo bem?');
    expect(container.querySelector('audio')).not.toBeInTheDocument();
    expect(api.fetchAudioMensagemUrl).not.toHaveBeenCalled();
  });
});

describe('ConversasPage — tempo real (SSE)', () => {
  it('abre a conexão SSE uma única vez ao montar', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);

    await renderPage();

    expect(api.abrirStreamConversas).toHaveBeenCalledTimes(1);
    expect(api.abrirStreamConversas).toHaveBeenCalledWith('token-teste', expect.objectContaining({
      onEvent: expect.any(Function),
      signal: expect.any(AbortSignal),
    }));
  });

  it('quando o stream termina sem erro (fim "limpo"), reconecta automaticamente após RECONEXAO_SSE_MS', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    let resolveStream;
    api.abrirStreamConversas
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStream = resolve; }))
      .mockImplementationOnce(() => new Promise(() => {}));

    await renderPage();
    expect(api.abrirStreamConversas).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      resolveStream();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);
    } finally {
      vi.useRealTimers();
    }

    expect(api.abrirStreamConversas).toHaveBeenCalledTimes(2);
  });

  it('evento "nova-mensagem" sempre rebusca a lista de conversas', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    expect(api.fetchConversas).toHaveBeenCalledTimes(1);

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3 });

    await waitFor(() => expect(api.fetchConversas).toHaveBeenCalledTimes(2));
  });

  it('evento "nova-mensagem" com contatoId igual ao selecionado também rebusca as mensagens', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledTimes(1));

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3 });

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledTimes(2));
    expect(api.fetchMensagens).toHaveBeenLastCalledWith('token-teste', 42, 3);
  });

  it('evento "nova-mensagem" com contatoId diferente do selecionado NÃO rebusca as mensagens', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledTimes(1));

    onEvent('nova-mensagem', { contatoId: 999, numeroRemetenteId: 3 });
    await waitFor(() => expect(api.fetchConversas).toHaveBeenCalledTimes(2));
    expect(api.fetchMensagens).toHaveBeenCalledTimes(1);
  });

  it('evento "nova-mensagem" com mesmo contatoId mas numeroRemetenteId diferente (outra thread do mesmo contato) NÃO rebusca as mensagens', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledTimes(1));

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 999 });
    await waitFor(() => expect(api.fetchConversas).toHaveBeenCalledTimes(2));
    expect(api.fetchMensagens).toHaveBeenCalledTimes(1);
  });

});

describe('ConversasPage — sino de notificações (Outlet context)', () => {
  it('abrir uma conversa chama refetchNotificacoes recebida via useOutletContext', async () => {
    const refetchNotificacoes = vi.fn();
    useOutletContext.mockReturnValue({ refetchNotificacoes });
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 3));
    await waitFor(() => expect(refetchNotificacoes).toHaveBeenCalledTimes(1));
  });

  it('ausência do context do Outlet (useOutletContext undefined) não quebra ao abrir uma conversa', async () => {
    useOutletContext.mockReturnValue(undefined);
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 3));
    expect((await screen.findAllByText('Oi, tudo bem?')).length).toBeGreaterThan(0);
  });

  it('ausência de refetchNotificacoes num context vazio ({}) também não quebra', async () => {
    useOutletContext.mockReturnValue({});
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 42, 3));
    expect((await screen.findAllByText('Oi, tudo bem?')).length).toBeGreaterThan(0);
  });
});

describe('ConversasPage — tempo real SSE (desmontagem)', () => {
  it('desmontar o componente aborta a conexão SSE', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    let capturedSignal;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      capturedSignal = opts.signal;
      return new Promise(() => {});
    });

    const { unmount } = await renderPage();

    expect(capturedSignal.aborted).toBe(false);
    unmount();
    expect(capturedSignal.aborted).toBe(true);
  });
});

describe('ConversasPage — lista de conversas: número remetente inicial', () => {
  it('mostra "via {apelido}" no item da lista quando numeroRemetenteInicial existe', async () => {
    api.fetchConversas.mockResolvedValue([
      conversa({ numeroRemetenteInicial: { id: 3, apelido: 'Teste Junior' } }),
    ]);

    await renderPage();

    expect(screen.getByText('via Teste Junior')).toBeInTheDocument();
  });

  it('não mostra nada extra no item da lista quando numeroRemetenteInicial é null', async () => {
    api.fetchConversas.mockResolvedValue([
      conversa({ numeroRemetenteInicial: null }),
    ]);

    await renderPage();

    expect(screen.getByText('Maria Silva')).toBeInTheDocument();
    expect(screen.queryByText(/^via /)).not.toBeInTheDocument();
  });
});

describe('ConversasPage — origem do atendimento (thread com um único número, do início ao fim)', () => {
  it('mostra "Atendido por: {apelido}" usando o numeroRemetenteAtual da thread selecionada', async () => {
    api.fetchConversas.mockResolvedValue([
      conversa({ numeroRemetenteAtual: { id: 3, apelido: 'Teste Junior' } }),
    ]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));

    expect(await screen.findByText('Atendido por: Teste Junior')).toBeInTheDocument();
    expect(screen.queryByText(/Iniciado por/)).not.toBeInTheDocument();
  });

  it('thread pré-selecionada via location.state que ainda não está na lista carregada: não quebra a tela e não mostra a linha extra', async () => {
    useLocation.mockReturnValue({
      pathname: '/controle-ligacoes/conversas',
      state: { contatoId: 99, numeroRemetenteId: 11, nome: 'Carla Nunes', telefone: '5598900009999' },
    });
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Mensagem da Carla', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();

    await screen.findByText('Mensagem da Carla');
    expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 99, 11);
    expect(screen.queryByText(/Atendido por/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Iniciado por/)).not.toBeInTheDocument();
  });
});

describe('ConversasPage — pré-seleção via location.state (dropdown de notificações)', () => {
  it('acessar a rota sem state (default) não pré-seleciona nenhuma conversa', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);

    await renderPage();

    expect(screen.getByText('Selecione uma conversa na lista ao lado para visualizar o histórico.')).toBeInTheDocument();
    expect(api.fetchMensagens).not.toHaveBeenCalled();
  });

  it('com location.state.contatoId/numeroRemetenteId, pré-seleciona a thread e carrega as mensagens sem esperar a lista', async () => {
    useLocation.mockReturnValue({
      pathname: '/controle-ligacoes/conversas',
      state: { contatoId: 99, numeroRemetenteId: 11, nome: 'Carla Nunes', telefone: '5598900009999' },
    });
    // Contato pré-selecionado nem precisa estar na lista já carregada — o numeroRemetenteId
    // vem direto do location.state (originado da notificação), não de uma busca na lista.
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Mensagem da Carla', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));

    await renderPage();

    await waitFor(() => expect(api.fetchMensagens).toHaveBeenCalledWith('token-teste', 99, 11));
    expect(await screen.findByText('Carla Nunes')).toBeInTheDocument();
    expect(screen.getByText('Mensagem da Carla')).toBeInTheDocument();
  });

  it('depois de consumir o state, navega em replace limpando o state (evita re-selecionar em voltar/atualizar)', async () => {
    useLocation.mockReturnValue({
      pathname: '/controle-ligacoes/conversas',
      state: { contatoId: 99, numeroRemetenteId: 11, nome: 'Carla Nunes', telefone: '5598900009999' },
    });
    api.fetchConversas.mockResolvedValue([]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta());

    await renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(
      '/controle-ligacoes/conversas', { replace: true, state: null }
    ));
  });
});

describe('ConversasPage — auto-scroll do painel de mensagens', () => {
  // jsdom não faz layout de verdade: scrollHeight/clientHeight de qualquer elemento são sempre 0
  // por padrão. Para testar a lógica de "perto do fim" precisamos simular esses valores via
  // spies nos getters do protótipo — scrollTop, ao contrário, já é uma propriedade
  // get/set funcional em jsdom (armazena o valor atribuído), então não precisa de mock.
  let mockScrollHeight;
  let mockClientHeight;

  beforeEach(() => {
    mockScrollHeight = 0;
    mockClientHeight = 0;
    vi.spyOn(window.HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => mockScrollHeight);
    vi.spyOn(window.HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => mockClientHeight);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('abrir uma conversa pela primeira vez sempre rola o painel pro fim', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    mockScrollHeight = 900;
    mockClientHeight = 300;

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const painel = screen.getByTestId('painel-mensagens');
    await waitFor(() => expect(painel.scrollTop).toBe(900));
  });

  it('enviar uma mensagem manualmente sempre rola o painel pro fim', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValue(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    api.enviarMensagem.mockResolvedValue({
      id: 2, remetente: 'colaboradora', corpo: 'Oi Maria!', criado_em: '2026-08-25T12:05:00.000Z',
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const painel = screen.getByTestId('painel-mensagens');
    // Simula o operador tendo rolado pra cima antes de enviar a resposta.
    mockScrollHeight = 900;
    mockClientHeight = 300;
    painel.scrollTop = 50;

    const textarea = screen.getByLabelText('Mensagem para o contato');
    fireEvent.change(textarea, { target: { value: 'Oi Maria!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await screen.findByText('Oi Maria!');
    await waitFor(() => expect(painel.scrollTop).toBe(900));
  });

  it('evento "nova-mensagem" com o operador já perto do fim rola o painel pro fim automaticamente', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValueOnce(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const painel = screen.getByTestId('painel-mensagens');
    // Operador está no fim do painel (dentro da tolerância).
    mockScrollHeight = 900;
    mockClientHeight = 300;
    painel.scrollTop = 900;

    // Quando a nova mensagem chega, o painel "cresce" (nova bolha ocupa espaço). A mudança de
    // scrollHeight só deve acontecer DEPOIS que o componente já mediu "perto do fim" com o
    // valor antigo (900) — por isso ela é feita dentro do mock de `fetchMensagens`, que só roda
    // quando `carregarMensagens` de fato dispara o refetch (depois da medição).
    api.fetchMensagens.mockImplementationOnce(() => {
      mockScrollHeight = 1300;
      return Promise.resolve(mensagensResposta({
        mensagens: [
          { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
          { id: 2, remetente: 'cliente', corpo: 'Nova mensagem!', criado_em: '2026-08-25T12:01:00.000Z' },
        ],
      }));
    });

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3 });

    await screen.findByText('Nova mensagem!');
    await waitFor(() => expect(painel.scrollTop).toBe(1300));
  });

  it('evento "nova-mensagem" com o operador rolado pra cima NÃO força o painel pro fim', async () => {
    api.fetchConversas.mockResolvedValue([conversa()]);
    api.fetchMensagens.mockResolvedValueOnce(mensagensResposta({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    }));
    let onEvent;
    api.abrirStreamConversas.mockImplementation((token, opts) => {
      onEvent = opts.onEvent;
      return new Promise(() => {});
    });

    await renderPage();
    fireEvent.click(screen.getByText('Maria Silva'));
    await screen.findByText('Oi, tudo bem?');

    const painel = screen.getByTestId('painel-mensagens');
    // Operador rolou pra cima pra ler mensagens antigas (bem longe do fim).
    mockScrollHeight = 900;
    mockClientHeight = 300;
    painel.scrollTop = 100;

    api.fetchMensagens.mockImplementationOnce(() => {
      mockScrollHeight = 1300;
      return Promise.resolve(mensagensResposta({
        mensagens: [
          { id: 1, remetente: 'cliente', corpo: 'Oi, tudo bem?', criado_em: '2026-08-25T12:00:00.000Z' },
          { id: 2, remetente: 'cliente', corpo: 'Nova mensagem!', criado_em: '2026-08-25T12:01:00.000Z' },
        ],
      }));
    });

    onEvent('nova-mensagem', { contatoId: 42, numeroRemetenteId: 3 });

    await screen.findByText('Nova mensagem!');
    // Posição de scroll do operador é preservada, não pula pro fim (1300).
    expect(painel.scrollTop).toBe(100);
  });
});
