const request = require('supertest');
const jwt = require('jsonwebtoken');
const conversasService = require('../services/conversas.service');
const mensagensEventsService = require('../services/mensagensEvents.service');
const app = require('../app');

function tokenFor({ role = 'operador_cobranca', id = 1 } = {}) {
  return jwt.sign(
    { id, email: 'liv@teste.com', isAdmin: false, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(conversasService)) {
    if (typeof conversasService[key] === 'function') {
      vi.spyOn(conversasService, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] conversas.service.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL/Baileys.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/conversas', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/conversas');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
  });

  it('200 — lista conversas, repassando busca/apenasNaoLidas, incluindo numeroRemetenteInicial', async () => {
    conversasService.listarConversas.mockResolvedValue([
      {
        contato: { id: 42, nome: 'Maria', telefone: '5598900000000' },
        numeroRemetenteAtual: { id: 3, apelido: 'CDC Cohatrac' },
        numeroRemetenteInicial: { id: 7, apelido: 'CDC Imperatriz' },
        ultimaMensagem: { corpo: 'oi', remetente: 'cliente', criado_em: '2026-08-25T12:00:00.000Z' },
        naoLidas: 2,
      },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas?busca=Maria&apenasNaoLidas=true')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].numeroRemetenteAtual).toEqual({ id: 3, apelido: 'CDC Cohatrac' });
    expect(res.body[0].numeroRemetenteInicial).toEqual({ id: 7, apelido: 'CDC Imperatriz' });
    expect(conversasService.listarConversas).toHaveBeenCalledWith({
      busca: 'Maria',
      apenasNaoLidas: true,
    });
  });

  it('apenasNaoLidas ausente vira false', async () => {
    conversasService.listarConversas.mockResolvedValue([]);

    await request(app)
      .get('/api/controle-ligacoes/conversas')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(conversasService.listarConversas).toHaveBeenCalledWith({
      busca: undefined,
      apenasNaoLidas: false,
    });
  });

  it('500 quando o service lança erro', async () => {
    conversasService.listarConversas.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar conversas.' });
  });
});

describe('GET /api/controle-ligacoes/notificacoes', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/notificacoes');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/notificacoes')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
  });

  it('200 — devolve a contagem de notificações não vistas e os itens', async () => {
    conversasService.contarNotificacoesNaoVistas.mockResolvedValue(3);
    conversasService.listarNotificacoesPendentes.mockResolvedValue([
      { contatoId: 42, nomeContato: 'Maria', telefone: '5598900000000', preview: 'oi', criado_em: '2026-08-25T12:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/notificacoes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      naoVistas: 3,
      itens: [
        { contatoId: 42, nomeContato: 'Maria', telefone: '5598900000000', preview: 'oi', criado_em: '2026-08-25T12:00:00.000Z' },
      ],
    });
  });

  it('200 — itens vazio quando não há notificações pendentes (naoVistas pode ser 0 também)', async () => {
    conversasService.contarNotificacoesNaoVistas.mockResolvedValue(0);
    conversasService.listarNotificacoesPendentes.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/controle-ligacoes/notificacoes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ naoVistas: 0, itens: [] });
  });

  it('500 quando o service lança erro', async () => {
    conversasService.contarNotificacoesNaoVistas.mockRejectedValue(new Error('boom'));
    conversasService.listarNotificacoesPendentes.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/controle-ligacoes/notificacoes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao contar notificações não vistas.' });
  });
});

describe('GET /api/controle-ligacoes/conversas/:contatoId/mensagens', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/conversas/42/mensagens');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/abc/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "contatoId" deve ser um número inteiro positivo.' });
    expect(conversasService.listarMensagens).not.toHaveBeenCalled();
  });

  it('404 quando o contato não existe', async () => {
    conversasService.listarMensagens.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/999/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Contato não encontrado.' });
  });

  it('200 — mensagens vazio e numeroRemetenteInicial null quando o contato existe mas nunca teve mensagem', async () => {
    conversasService.listarMensagens.mockResolvedValue({ mensagens: [], numeroRemetenteInicial: null });

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mensagens: [], numeroRemetenteInicial: null });
  });

  it('200 — lista mensagens ordenadas e numeroRemetenteInicial', async () => {
    conversasService.listarMensagens.mockResolvedValue({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'oi', criado_em: '2026-08-25T11:00:00.000Z' },
        { id: 2, remetente: 'ia', corpo: 'olá!', criado_em: '2026-08-25T11:01:00.000Z' },
      ],
      numeroRemetenteInicial: { id: 3, apelido: 'Teste Junior' },
    });

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body.mensagens).toHaveLength(2);
    expect(res.body.numeroRemetenteInicial).toEqual({ id: 3, apelido: 'Teste Junior' });
    expect(conversasService.listarMensagens).toHaveBeenCalledWith(42);
  });

  it('500 quando o service lança erro', async () => {
    conversasService.listarMensagens.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar mensagens do contato.' });
  });
});

describe('POST /api/controle-ligacoes/conversas/:contatoId/mensagens', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .send({ corpo: 'oi' });
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/abc/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "contatoId" deve ser um número inteiro positivo.' });
    expect(conversasService.responder).not.toHaveBeenCalled();
  });

  it('400 quando "corpo" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo" é obrigatório.' });
    expect(conversasService.responder).not.toHaveBeenCalled();
  });

  it('400 quando "corpo" é só espaços', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo" é obrigatório.' });
  });

  it('404 quando o contato não existe', async () => {
    conversasService.responder.mockResolvedValue({ status: 'contato_nao_encontrado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/999/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Contato não encontrado.' });
  });

  it('400 quando o contato não tem histórico de conversa', async () => {
    conversasService.responder.mockResolvedValue({ status: 'sem_historico' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Não é possível responder um contato sem histórico de conversa.' });
  });

  it('409 quando o número está desconectado', async () => {
    conversasService.responder.mockResolvedValue({ status: 'numero_desconectado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Número não está conectado.' });
  });

  it('500 quando onWhatsApp não confirma o número (sem_whatsapp)', async () => {
    conversasService.responder.mockResolvedValue({
      status: 'sem_whatsapp',
      erro: 'Número não possui WhatsApp ativo ou não pôde ser verificado.',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Número não possui WhatsApp ativo ou não pôde ser verificado.' });
  });

  it('500 quando o envio falha (falha_envio)', async () => {
    conversasService.responder.mockResolvedValue({ status: 'falha_envio', erro: 'timeout de rede' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'timeout de rede' });
  });

  it('201 — envia com sucesso e devolve a mensagem gravada', async () => {
    conversasService.responder.mockResolvedValue({
      status: 'enviada',
      mensagem: { id: 10, remetente: 'colaboradora', corpo: 'oi', criado_em: '2026-08-25T12:00:00.000Z' },
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 10,
      remetente: 'colaboradora',
      corpo: 'oi',
      criado_em: '2026-08-25T12:00:00.000Z',
    });
    expect(conversasService.responder).toHaveBeenCalledWith(42, 'oi');
  });

  it('500 quando o service lança erro', async () => {
    conversasService.responder.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao responder contato.' });
  });
});

describe('GET /api/controle-ligacoes/conversas/stream', () => {
  afterEach(() => {
    mensagensEventsService.removeAllListeners('mensagem-recebida');
  });

  function conectarStream({ aoConectar, deveEncerrar } = {}) {
    return new Promise((resolve, reject) => {
      const test = request(app)
        .get('/api/controle-ligacoes/conversas/stream')
        .set('Authorization', `Bearer ${tokenFor()}`);
      test.buffer(false);

      let body = '';
      let headers = null;

      test.on('response', (res) => {
        headers = res.headers;
        res.on('error', () => {
        });
        res.on('data', (chunk) => {
          body += chunk.toString();
          if (deveEncerrar?.(body)) {
            test.abort();
          }
        });
        aoConectar?.({ headers });
      });

      test.end((err) => {
        if (err && !/aborted|ECONNRESET/i.test(err.message || '')) {
          return reject(err);
        }
        resolve({ headers, body });
      });
    });
  }

  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/conversas/stream');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/stream')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);
    expect(res.status).toBe(403);
  });

  it(
    'abre com headers de SSE, registra o listener em mensagensEvents.service, repassa ' +
      '"mensagem-recebida" como "event: nova-mensagem" e remove o listener ao fechar',
    async () => {
      expect(mensagensEventsService.listenerCount('mensagem-recebida')).toBe(0);
      const onSpy = vi.spyOn(mensagensEventsService, 'on');
      const offSpy = vi.spyOn(mensagensEventsService, 'off');

      const resultado = await conectarStream({
        aoConectar: () => {
          expect(mensagensEventsService.listenerCount('mensagem-recebida')).toBe(1);
          expect(onSpy).toHaveBeenCalledWith('mensagem-recebida', expect.any(Function));
          mensagensEventsService.emit('mensagem-recebida', { contatoId: 42, numeroRemetenteId: 17 });
        },
        deveEncerrar: (body) => body.includes('\n\n'),
      });

      expect(resultado.headers['content-type']).toMatch(/text\/event-stream/);
      expect(resultado.headers['cache-control']).toBe('no-store');
      expect(resultado.body).toBe(
        'event: nova-mensagem\ndata: {"contatoId":42,"numeroRemetenteId":17}\n\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(offSpy).toHaveBeenCalledWith('mensagem-recebida', expect.any(Function));
      expect(onSpy.mock.calls[0][1]).toBe(offSpy.mock.calls[0][1]);
      expect(mensagensEventsService.listenerCount('mensagem-recebida')).toBe(0);
    }
  );

  it('repassa "primeiraResposta" quando presente no payload do emit (sino de notificações)', async () => {
    const resultado = await conectarStream({
      aoConectar: () => {
        mensagensEventsService.emit('mensagem-recebida', {
          contatoId: 42,
          numeroRemetenteId: 17,
          primeiraResposta: true,
        });
      },
      deveEncerrar: (body) => body.includes('\n\n'),
    });

    expect(resultado.body).toBe(
      'event: nova-mensagem\ndata: {"contatoId":42,"numeroRemetenteId":17,"primeiraResposta":true}\n\n'
    );
  });

  it('não emite nada quando nenhum evento "mensagem-recebida" acontece (canal fica em silêncio)', async () => {
    const resultado = await conectarStream({
      aoConectar: () => {
        setTimeout(() => {
          mensagensEventsService.emit('outro-evento-qualquer', {});
        }, 10);
        setTimeout(() => {
          mensagensEventsService.emit('mensagem-recebida', { contatoId: 1, numeroRemetenteId: 2 });
        }, 20);
      },
      deveEncerrar: (body) => body.includes('\n\n'),
    });

    expect(resultado.body).toBe('event: nova-mensagem\ndata: {"contatoId":1,"numeroRemetenteId":2}\n\n');
  });
});
