const mensagensModel = require('../models/mensagens.model');
const baileysSessionService = require('../services/baileysSession.service');
const conversasService = require('./conversas.service');

beforeEach(() => {
  vi.restoreAllMocks();

  for (const key of Object.keys(mensagensModel)) {
    if (typeof mensagensModel[key] === 'function') {
      vi.spyOn(mensagensModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] mensagens.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }

  vi.spyOn(baileysSessionService, 'obterSocketConectado').mockReturnValue(null);
});

describe('conversas.service.listarConversas', () => {
  it('repassa busca/apenasNaoLidas para o model', async () => {
    mensagensModel.listConversas.mockResolvedValue([{ contato: { id: 1 } }]);

    const resultado = await conversasService.listarConversas({ busca: 'Maria', apenasNaoLidas: true });

    expect(resultado).toEqual([{ contato: { id: 1 } }]);
    expect(mensagensModel.listConversas).toHaveBeenCalledWith({ busca: 'Maria', apenasNaoLidas: true });
  });
});

describe('conversas.service.contarNotificacoesNaoVistas', () => {
  it('repassa o total devolvido pelo model', async () => {
    mensagensModel.contarNotificacoesNaoVistas.mockResolvedValue(5);

    const resultado = await conversasService.contarNotificacoesNaoVistas();

    expect(resultado).toBe(5);
    expect(mensagensModel.contarNotificacoesNaoVistas).toHaveBeenCalledWith();
  });
});

describe('conversas.service.listarNotificacoesPendentes', () => {
  it('repassa a lista devolvida pelo model', async () => {
    const itens = [
      { contatoId: 42, nomeContato: 'Maria', telefone: '5598900000000', preview: 'oi', criado_em: '2026-08-25T12:00:00.000Z' },
    ];
    mensagensModel.listNotificacoesPendentes.mockResolvedValue(itens);

    const resultado = await conversasService.listarNotificacoesPendentes();

    expect(resultado).toEqual(itens);
    expect(mensagensModel.listNotificacoesPendentes).toHaveBeenCalledWith();
  });

  it('repassa lista vazia sem erro', async () => {
    mensagensModel.listNotificacoesPendentes.mockResolvedValue([]);

    const resultado = await conversasService.listarNotificacoesPendentes();

    expect(resultado).toEqual([]);
  });

  it('preserva o preview truncado (>80 chars) e o preview curto (<=80 chars) tal como o model devolve', async () => {
    const corpoLongo = 'a'.repeat(90);
    const previewTruncado = `${'a'.repeat(80)}…`;
    const itens = [
      { contatoId: 1, nomeContato: 'Maria', telefone: '5598900000000', preview: previewTruncado, criado_em: '2026-08-25T12:00:00.000Z' },
      { contatoId: 2, nomeContato: 'João', telefone: '5598900000001', preview: 'ola', criado_em: '2026-08-25T12:01:00.000Z' },
    ];
    mensagensModel.listNotificacoesPendentes.mockResolvedValue(itens);

    const resultado = await conversasService.listarNotificacoesPendentes();

    expect(resultado[0].preview).toHaveLength(81);
    expect(resultado[0].preview.endsWith('…')).toBe(true);
    expect(corpoLongo.length).toBeGreaterThan(80);
    expect(resultado[1].preview).toBe('ola');
  });
});

describe('conversas.service.listarMensagens', () => {
  const NUMERO_REMETENTE_ID = 7;

  it('retorna null quando o contato não existe (controller decide o 404)', async () => {
    mensagensModel.existeContato.mockResolvedValue(false);

    const resultado = await conversasService.listarMensagens(999, NUMERO_REMETENTE_ID);

    expect(resultado).toBeNull();
    expect(mensagensModel.listMensagensEMarcarLidas).not.toHaveBeenCalled();
  });

  it('busca mensagens da thread (contatoId, numeroRemetenteId) quando o contato existe', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.listMensagensEMarcarLidas.mockResolvedValue([{ id: 1, remetente: 'cliente', corpo: 'oi' }]);

    const resultado = await conversasService.listarMensagens(42, NUMERO_REMETENTE_ID);

    expect(resultado).toEqual({
      mensagens: [{ id: 1, remetente: 'cliente', corpo: 'oi' }],
    });
    expect(mensagensModel.listMensagensEMarcarLidas).toHaveBeenCalledWith(42, NUMERO_REMETENTE_ID);
  });

  it('mensagens vem vazio quando a thread existe mas ainda não tem histórico', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.listMensagensEMarcarLidas.mockResolvedValue([]);

    const resultado = await conversasService.listarMensagens(42, NUMERO_REMETENTE_ID);

    expect(resultado).toEqual({ mensagens: [] });
  });
});

describe('conversas.service.responder', () => {
  const CONTATO_ID = 42;
  const NUMERO_REMETENTE_ID = 3;

  it('status=contato_nao_encontrado quando o contato não existe', async () => {
    mensagensModel.existeContato.mockResolvedValue(false);

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({ status: 'contato_nao_encontrado' });
    expect(mensagensModel.existeMensagemNaThread).not.toHaveBeenCalled();
  });

  it('status=sem_historico quando existeMensagemNaThread retorna false', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(false);

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({ status: 'sem_historico' });
    expect(mensagensModel.existeMensagemNaThread).toHaveBeenCalledWith(CONTATO_ID, NUMERO_REMETENTE_ID);
    expect(baileysSessionService.obterSocketConectado).not.toHaveBeenCalled();
  });

  it('status=numero_desconectado quando a sessão Baileys não está conectada', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    baileysSessionService.obterSocketConectado.mockReturnValue(null);

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({ status: 'numero_desconectado' });
  });

  it('status=sem_whatsapp quando sock.onWhatsApp não confirma o número', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    mensagensModel.findTelefoneContato.mockResolvedValue('5598900000000');

    const sendMessage = vi.fn();
    const onWhatsApp = vi.fn().mockResolvedValue([]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({
      status: 'sem_whatsapp',
      erro: 'Número não possui WhatsApp ativo ou não pôde ser verificado.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('status=sem_whatsapp quando sock.onWhatsApp lança erro', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    mensagensModel.findTelefoneContato.mockResolvedValue('5598900000000');

    const sendMessage = vi.fn();
    const onWhatsApp = vi.fn().mockRejectedValue(new Error('conexão instável'));
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({ status: 'sem_whatsapp', erro: 'conexão instável' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('status=falha_envio quando sock.sendMessage lança erro', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    mensagensModel.findTelefoneContato.mockResolvedValue('5598900000000');

    const sendMessage = vi.fn().mockRejectedValue(new Error('timeout de rede'));
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '5598900000000@s.whatsapp.net', exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(resultado).toEqual({ status: 'falha_envio', erro: 'timeout de rede' });
    expect(mensagensModel.inserirMensagemEnviada).not.toHaveBeenCalled();
  });

  it('status=enviada e grava em Mensagens (remetente=colaboradora) usando o jid confirmado', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    mensagensModel.findTelefoneContato.mockResolvedValue('5598900000000');
    mensagensModel.inserirMensagemEnviada.mockResolvedValue({
      id: 10,
      remetente: 'colaboradora',
      corpo: 'oi',
      criado_em: '2026-08-25T12:00:00.000Z',
      baileys_message_id: 'ALGUM_ID',
      status_entrega: 'pendente',
    });

    const sendMessage = vi.fn().mockResolvedValue({ key: { id: 'ALGUM_ID' } });
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '5598900000000@s.whatsapp.net', exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    const resultado = await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(sendMessage).toHaveBeenCalledWith('5598900000000@s.whatsapp.net', { text: 'oi' });
    expect(mensagensModel.inserirMensagemEnviada).toHaveBeenCalledWith({
      contatoId: CONTATO_ID,
      numeroRemetenteId: NUMERO_REMETENTE_ID,
      remetente: 'colaboradora',
      corpo: 'oi',
      baileysMessageId: 'ALGUM_ID',
      statusEntrega: 'pendente',
    });
    expect(resultado).toEqual({
      status: 'enviada',
      mensagem: {
        id: 10,
        remetente: 'colaboradora',
        corpo: 'oi',
        criado_em: '2026-08-25T12:00:00.000Z',
        baileys_message_id: 'ALGUM_ID',
        status_entrega: 'pendente',
      },
    });
  });

  it('status=enviada grava baileysMessageId=null quando sock.sendMessage não devolve key.id', async () => {
    mensagensModel.existeContato.mockResolvedValue(true);
    mensagensModel.existeMensagemNaThread.mockResolvedValue(true);
    mensagensModel.findTelefoneContato.mockResolvedValue('5598900000000');
    mensagensModel.inserirMensagemEnviada.mockResolvedValue({
      id: 11,
      remetente: 'colaboradora',
      corpo: 'oi',
      criado_em: '2026-08-25T12:00:00.000Z',
      baileys_message_id: null,
      status_entrega: 'pendente',
    });

    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const onWhatsApp = vi.fn().mockResolvedValue([{ jid: '5598900000000@s.whatsapp.net', exists: true }]);
    baileysSessionService.obterSocketConectado.mockReturnValue({ sendMessage, onWhatsApp });

    await conversasService.responder(CONTATO_ID, NUMERO_REMETENTE_ID, 'oi');

    expect(mensagensModel.inserirMensagemEnviada).toHaveBeenCalledWith({
      contatoId: CONTATO_ID,
      numeroRemetenteId: NUMERO_REMETENTE_ID,
      remetente: 'colaboradora',
      corpo: 'oi',
      baileysMessageId: null,
      statusEntrega: 'pendente',
    });
  });
});

describe('conversas.service.atualizarStatus', () => {
  it('retorna o sentinel "motivo_obrigatorio" e NÃO chama o model quando status="perdido" sem motivo', async () => {
    const resultado = await conversasService.atualizarStatus(1, 2, 'perdido');

    expect(resultado).toBe('motivo_obrigatorio');
    expect(mensagensModel.upsertStatusConversa).not.toHaveBeenCalled();
  });

  it('retorna o sentinel "motivo_obrigatorio" quando motivo é string vazia', async () => {
    const resultado = await conversasService.atualizarStatus(1, 2, 'perdido', '');

    expect(resultado).toBe('motivo_obrigatorio');
    expect(mensagensModel.upsertStatusConversa).not.toHaveBeenCalled();
  });

  it('retorna o sentinel "motivo_obrigatorio" quando motivo é explicitamente null', async () => {
    const resultado = await conversasService.atualizarStatus(1, 2, 'perdido', null);

    expect(resultado).toBe('motivo_obrigatorio');
    expect(mensagensModel.upsertStatusConversa).not.toHaveBeenCalled();
  });

  it('delega para o model quando status="perdido" com motivo presente', async () => {
    mensagensModel.upsertStatusConversa.mockResolvedValue(undefined);

    const resultado = await conversasService.atualizarStatus(1, 2, 'perdido', 'preco_condicao', 'Achou caro');

    expect(resultado).toBeUndefined();
    expect(mensagensModel.upsertStatusConversa).toHaveBeenCalledWith(1, 2, 'perdido', 'preco_condicao', 'Achou caro');
  });

  it('retorna o sentinel "atendeu_nao_permitido" mesmo se motivo/motivoDetalhe forem informados por engano', async () => {
    const resultado = await conversasService.atualizarStatus(1, 2, 'atendeu', 'preco_condicao', 'Achou caro');

    expect(resultado).toBe('atendeu_nao_permitido');
    expect(mensagensModel.upsertStatusConversa).not.toHaveBeenCalled();
  });

  it('delega para o model sem exigir motivo quando status é qualquer outro valor', async () => {
    mensagensModel.upsertStatusConversa.mockResolvedValue(undefined);

    await conversasService.atualizarStatus(1, 2, 'venda');

    expect(mensagensModel.upsertStatusConversa).toHaveBeenCalledWith(1, 2, 'venda', null, null);
  });

  it('retorna o sentinel "atendeu_nao_permitido" e NÃO chama o model quando status="atendeu" é setado manualmente', async () => {
    const resultado = await conversasService.atualizarStatus(1, 2, 'atendeu');

    expect(resultado).toBe('atendeu_nao_permitido');
    expect(mensagensModel.upsertStatusConversa).not.toHaveBeenCalled();
  });
});

describe('conversas.service.listarPipeline', () => {
  it('repassa todos os filtros para o model', async () => {
    mensagensModel.listPipeline.mockResolvedValue([{ contato_id: 1, status: 'perdido' }]);

    const resultado = await conversasService.listarPipeline({
      busca: 'Ana',
      numeroRemetenteId: 3,
      statusInicio: '2026-08-01',
      statusFim: '2026-08-31',
      disparoInicio: '2026-07-01',
      disparoFim: '2026-07-31',
    });

    expect(resultado).toEqual([{ contato_id: 1, status: 'perdido' }]);
    expect(mensagensModel.listPipeline).toHaveBeenCalledWith({
      busca: 'Ana',
      numeroRemetenteId: 3,
      statusInicio: '2026-08-01',
      statusFim: '2026-08-31',
      disparoInicio: '2026-07-01',
      disparoFim: '2026-07-31',
    });
  });

  it('funciona sem nenhum filtro (todos undefined)', async () => {
    mensagensModel.listPipeline.mockResolvedValue([]);

    const resultado = await conversasService.listarPipeline();

    expect(resultado).toEqual([]);
    expect(mensagensModel.listPipeline).toHaveBeenCalledWith({
      busca: undefined,
      numeroRemetenteId: undefined,
      statusInicio: undefined,
      statusFim: undefined,
      disparoInicio: undefined,
      disparoFim: undefined,
    });
  });
});

describe('conversas.service.listarHistoricoStatus', () => {
  it('repassa contatoId/numeroRemetenteId para o model e devolve a lista tal como veio', async () => {
    const historico = [
      { status_anterior: 'atendeu', status_novo: 'perdido', origem: 'atendente', alterado_em: '2026-08-02T00:00:00.000Z' },
    ];
    mensagensModel.listHistoricoStatus.mockResolvedValue(historico);

    const resultado = await conversasService.listarHistoricoStatus(1, 2);

    expect(resultado).toBe(historico);
    expect(mensagensModel.listHistoricoStatus).toHaveBeenCalledWith(1, 2);
  });

  it('devolve array vazio quando a thread nunca teve mudança de status registrada', async () => {
    mensagensModel.listHistoricoStatus.mockResolvedValue([]);

    const resultado = await conversasService.listarHistoricoStatus(99, 99);

    expect(resultado).toEqual([]);
  });
});
