const dbModule = require('../config/db');
const { sql } = dbModule;

const getPoolSpy = vi.spyOn(dbModule, 'getPool');

const mensagensModel = require('./mensagens.model');

function criarPoolMock() {
  const request = {
    input: vi.fn().mockReturnThis(),
    query: vi.fn(),
  };
  const pool = { request: vi.fn(() => request) };
  getPoolSpy.mockResolvedValue(pool);
  return { pool, request };
}

describe('mensagens.model.inserirMensagemEnviada', () => {
  it('grava baileys_message_id/status_entrega como NULL quando não informados (default)', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [{ id: 1, remetente: 'colaboradora', corpo: 'oi', baileys_message_id: null, status_entrega: null, criado_em: '2026-08-26T00:00:00.000Z' }],
    });

    const resultado = await mensagensModel.inserirMensagemEnviada({
      contatoId: 42,
      numeroRemetenteId: 7,
      remetente: 'colaboradora',
      corpo: 'oi',
    });

    expect(request.input).toHaveBeenCalledWith('baileysMessageId', sql.VarChar(100), null);
    expect(request.input).toHaveBeenCalledWith('statusEntrega', sql.VarChar(20), null);
    expect(resultado.id).toBe(1);
  });

  it('grava baileys_message_id/status_entrega quando informados', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [{ id: 2, remetente: 'ia', corpo: 'oi', baileys_message_id: 'ABC123', status_entrega: 'pendente', criado_em: '2026-08-26T00:00:00.000Z' }],
    });

    await mensagensModel.inserirMensagemEnviada({
      contatoId: 42,
      numeroRemetenteId: 7,
      remetente: 'ia',
      corpo: 'oi',
      baileysMessageId: 'ABC123',
      statusEntrega: 'pendente',
    });

    expect(request.input).toHaveBeenCalledWith('baileysMessageId', sql.VarChar(100), 'ABC123');
    expect(request.input).toHaveBeenCalledWith('statusEntrega', sql.VarChar(20), 'pendente');
  });
});

describe('mensagens.model.inserirMensagemRecebida', () => {
  it('grava status_entrega=NULL por padrão (mensagem de cliente)', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [{ id: 3, remetente: 'cliente', corpo: 'oi', criado_em: '2026-08-26T00:00:00.000Z', e_primeira_resposta_cliente: false }],
    });

    await mensagensModel.inserirMensagemRecebida({
      contatoId: 42,
      numeroRemetenteId: 7,
      corpo: 'oi',
      baileysMessageId: 'X1',
      ePrimeiraRespostaCliente: false,
    });

    expect(request.input).toHaveBeenCalledWith('statusEntrega', sql.VarChar(20), null);
    expect(request.input).toHaveBeenCalledWith('remetente', sql.VarChar(20), 'cliente');
  });

  it('grava status_entrega="enviado" quando informado (mensagem manual do atendente)', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [{ id: 4, remetente: 'atendente', corpo: 'oi', criado_em: '2026-08-26T00:00:00.000Z', e_primeira_resposta_cliente: false }],
    });

    await mensagensModel.inserirMensagemRecebida({
      contatoId: 42,
      numeroRemetenteId: 7,
      corpo: 'oi',
      baileysMessageId: 'X2',
      ePrimeiraRespostaCliente: false,
      remetente: 'atendente',
      statusEntrega: 'enviado',
    });

    expect(request.input).toHaveBeenCalledWith('statusEntrega', sql.VarChar(20), 'enviado');
    expect(request.input).toHaveBeenCalledWith('remetente', sql.VarChar(20), 'atendente');
  });
});

describe('mensagens.model.listMensagensEMarcarLidas', () => {
  it('seleciona baileys_message_id/status_entrega e devolve as linhas tal como o banco retornou', async () => {
    const { request } = criarPoolMock();
    const linhas = [
      { id: 1, remetente: 'cliente', corpo: 'oi', criado_em: '2026-08-26T00:00:00.000Z', baileys_message_id: 'A1', status_entrega: null },
      { id: 2, remetente: 'colaboradora', corpo: 'olá', criado_em: '2026-08-26T00:01:00.000Z', baileys_message_id: 'A2', status_entrega: 'entregue' },
    ];
    request.query
      .mockResolvedValueOnce({ recordset: linhas })
      .mockResolvedValueOnce({ recordset: [] });

    const resultado = await mensagensModel.listMensagensEMarcarLidas(42, 7);

    expect(resultado).toEqual(linhas);
    expect(request.query.mock.calls[0][0]).toContain('baileys_message_id');
    expect(request.query.mock.calls[0][0]).toContain('status_entrega');
  });
});

describe('mensagens.model.atualizarStatusEntrega', () => {
  it('avança o status e devolve contato_id/numero_remetente_id/status_entrega da linha atualizada', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [{ contato_id: 42, numero_remetente_id: 7, status_entrega: 'entregue' }],
    });

    const resultado = await mensagensModel.atualizarStatusEntrega('MSG1', 'entregue');

    expect(request.input).toHaveBeenCalledWith('baileysMessageId', sql.VarChar(100), 'MSG1');
    expect(request.input).toHaveBeenCalledWith('novoStatus', sql.VarChar(20), 'entregue');
    expect(resultado).toEqual({ contato_id: 42, numero_remetente_id: 7, status_entrega: 'entregue' });
  });

  it('não regride: quando o UPDATE não afeta nenhuma linha (status atual já é igual/mais avançado), devolve null', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    const resultado = await mensagensModel.atualizarStatusEntrega('MSG2', 'enviado');

    expect(resultado).toBeNull();
  });

  it('baileysMessageId inexistente devolve null', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    const resultado = await mensagensModel.atualizarStatusEntrega('NAO_EXISTE', 'lido');

    expect(resultado).toBeNull();
  });
});
