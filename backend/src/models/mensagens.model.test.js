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

describe('mensagens.model.registrarHistoricoStatus', () => {
  it('grava contatoId/numeroRemetenteId/statusAnterior/statusNovo/origem/motivo/motivoDetalhe via INSERT parametrizado', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    await mensagensModel.registrarHistoricoStatus(1, 2, 'atendeu', 'perdido', 'atendente', 'preco_condicao', 'Achou caro');

    expect(request.input).toHaveBeenCalledWith('contatoId', sql.Int, 1);
    expect(request.input).toHaveBeenCalledWith('numeroRemetenteId', sql.Int, 2);
    expect(request.input).toHaveBeenCalledWith('statusAnterior', sql.VarChar(20), 'atendeu');
    expect(request.input).toHaveBeenCalledWith('statusNovo', sql.VarChar(20), 'perdido');
    expect(request.input).toHaveBeenCalledWith('origem', sql.VarChar(20), 'atendente');
    expect(request.input).toHaveBeenCalledWith('motivo', sql.VarChar(30), 'preco_condicao');
    expect(request.input).toHaveBeenCalledWith('motivoDetalhe', sql.NVarChar(255), 'Achou caro');
    expect(request.query.mock.calls[0][0]).toContain('INSERT INTO StatusHistorico');
  });

  it('grava statusAnterior/motivo/motivoDetalhe como NULL quando ausentes (defaults)', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    await mensagensModel.registrarHistoricoStatus(1, 2, null, 'atendeu', 'sistema');

    expect(request.input).toHaveBeenCalledWith('statusAnterior', sql.VarChar(20), null);
    expect(request.input).toHaveBeenCalledWith('motivo', sql.VarChar(30), null);
    expect(request.input).toHaveBeenCalledWith('motivoDetalhe', sql.NVarChar(255), null);
  });
});

describe('mensagens.model.upsertStatusConversa', () => {
  it('lê o status ANTERIOR antes do MERGE e registra o histórico com origem="atendente"', async () => {
    const { request } = criarPoolMock();
    request.query
      .mockResolvedValueOnce({ recordset: [{ status: 'atendeu' }] }) // SELECT status atual
      .mockResolvedValueOnce({ recordset: [] }) // MERGE
      .mockResolvedValueOnce({ recordset: [] }); // INSERT StatusHistorico (via registrarHistoricoStatus)

    await mensagensModel.upsertStatusConversa(1, 2, 'perdido', 'preco_condicao', 'Achou caro');

    expect(request.query).toHaveBeenCalledTimes(3);
    expect(request.query.mock.calls[0][0]).toContain('SELECT status');
    expect(request.query.mock.calls[1][0]).toContain('MERGE ConversasStatus');
    expect(request.query.mock.calls[2][0]).toContain('INSERT INTO StatusHistorico');
    expect(request.input).toHaveBeenCalledWith('statusAnterior', sql.VarChar(20), 'atendeu');
    expect(request.input).toHaveBeenCalledWith('statusNovo', sql.VarChar(20), 'perdido');
    expect(request.input).toHaveBeenCalledWith('origem', sql.VarChar(20), 'atendente');
  });

  it('quando a thread ainda não tem status (nova), grava statusAnterior=null no histórico', async () => {
    const { request } = criarPoolMock();
    request.query
      .mockResolvedValueOnce({ recordset: [] }) // SELECT status atual — thread nova
      .mockResolvedValueOnce({ recordset: [] }) // MERGE
      .mockResolvedValueOnce({ recordset: [] }); // INSERT StatusHistorico

    await mensagensModel.upsertStatusConversa(9, 9, 'atendeu');

    expect(request.input).toHaveBeenCalledWith('statusAnterior', sql.VarChar(20), null);
    expect(request.input).toHaveBeenCalledWith('statusNovo', sql.VarChar(20), 'atendeu');
  });
});

describe('mensagens.model.marcarAtendeuSeVazio', () => {
  it('quando a thread NÃO tem status ainda, insere status="atendeu" e registra histórico com origem="sistema"/statusAnterior=null', async () => {
    const { request } = criarPoolMock();
    request.query
      .mockResolvedValueOnce({ recordset: [{ id: 55 }] }) // INSERT condicional efetivou (OUTPUT inserted.id)
      .mockResolvedValueOnce({ recordset: [] }); // INSERT StatusHistorico

    await mensagensModel.marcarAtendeuSeVazio(1, 2);

    expect(request.query).toHaveBeenCalledTimes(2);
    expect(request.query.mock.calls[1][0]).toContain('INSERT INTO StatusHistorico');
    expect(request.input).toHaveBeenCalledWith('statusAnterior', sql.VarChar(20), null);
    expect(request.input).toHaveBeenCalledWith('statusNovo', sql.VarChar(20), 'atendeu');
    expect(request.input).toHaveBeenCalledWith('origem', sql.VarChar(20), 'sistema');
  });

  it('quando a thread JÁ tem status, o INSERT condicional não insere nada e NÃO registra histórico', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValueOnce({ recordset: [] }); // IF NOT EXISTS falso — nada inserido

    await mensagensModel.marcarAtendeuSeVazio(1, 2);

    expect(request.query).toHaveBeenCalledTimes(1);
  });
});

describe('mensagens.model.listPipeline', () => {
  it('mapeia motivo_detalhe -> motivoDetalhe e preserva os demais campos tal como o banco devolve', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({
      recordset: [
        {
          contato_id: 1,
          nome: 'Ana',
          telefone: '5598900000000',
          numero_remetente_id: 2,
          apelido: 'Bruno',
          status: 'perdido',
          atualizado_em: '2026-08-02T00:00:00.000Z',
          motivo: 'preco_condicao',
          motivo_detalhe: 'Achou caro',
        },
      ],
    });

    const resultado = await mensagensModel.listPipeline({});

    expect(resultado).toEqual([
      {
        contato_id: 1,
        nome: 'Ana',
        telefone: '5598900000000',
        numero_remetente_id: 2,
        apelido: 'Bruno',
        status: 'perdido',
        atualizado_em: '2026-08-02T00:00:00.000Z',
        motivo: 'preco_condicao',
        motivoDetalhe: 'Achou caro',
      },
    ]);
  });

  it('grava busca como LIKE com wildcards (%busca%) e os demais filtros como null quando ausentes', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    await mensagensModel.listPipeline({ busca: 'Ana' });

    expect(request.input).toHaveBeenCalledWith('busca', sql.NVarChar, '%Ana%');
    expect(request.input).toHaveBeenCalledWith('numeroRemetenteId', sql.Int, null);
    expect(request.input).toHaveBeenCalledWith('statusInicio', sql.Date, null);
    expect(request.input).toHaveBeenCalledWith('statusFim', sql.Date, null);
    expect(request.input).toHaveBeenCalledWith('disparoInicio', sql.Date, null);
    expect(request.input).toHaveBeenCalledWith('disparoFim', sql.Date, null);
  });

  it('devolve array vazio quando nenhuma thread tem status atribuído', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    const resultado = await mensagensModel.listPipeline();

    expect(resultado).toEqual([]);
  });
});

describe('mensagens.model.listHistoricoStatus', () => {
  it('busca por contatoId/numeroRemetenteId e ordena por alterado_em DESC (mais recente primeiro)', async () => {
    const { request } = criarPoolMock();
    const linhas = [
      { status_anterior: 'atendeu', status_novo: 'perdido', origem: 'atendente', motivo: 'preco_condicao', motivo_detalhe: null, alterado_em: '2026-08-02T00:00:00.000Z' },
      { status_anterior: null, status_novo: 'atendeu', origem: 'sistema', motivo: null, motivo_detalhe: null, alterado_em: '2026-08-01T00:00:00.000Z' },
    ];
    request.query.mockResolvedValue({ recordset: linhas });

    const resultado = await mensagensModel.listHistoricoStatus(1, 2);

    expect(request.input).toHaveBeenCalledWith('contatoId', sql.Int, 1);
    expect(request.input).toHaveBeenCalledWith('numeroRemetenteId', sql.Int, 2);
    expect(request.query.mock.calls[0][0]).toContain('ORDER BY alterado_em DESC');
    expect(resultado).toEqual(linhas);
  });

  it('devolve array vazio quando a thread nunca teve mudança de status registrada', async () => {
    const { request } = criarPoolMock();
    request.query.mockResolvedValue({ recordset: [] });

    const resultado = await mensagensModel.listHistoricoStatus(99, 99);

    expect(resultado).toEqual([]);
  });
});
