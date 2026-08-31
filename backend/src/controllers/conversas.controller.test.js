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
      {
        contatoId: 42,
        numeroRemetenteId: 7,
        nomeContato: 'Maria',
        telefone: '5598900000000',
        preview: 'oi',
        criado_em: '2026-08-25T12:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/notificacoes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      naoVistas: 3,
      itens: [
        {
          contatoId: 42,
          numeroRemetenteId: 7,
          nomeContato: 'Maria',
          telefone: '5598900000000',
          preview: 'oi',
          criado_em: '2026-08-25T12:00:00.000Z',
        },
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

describe('GET /api/controle-ligacoes/conversas/:contatoId/:numeroRemetenteId/mensagens', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/conversas/42/7/mensagens');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/abc/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.',
    });
    expect(conversasService.listarMensagens).not.toHaveBeenCalled();
  });

  it('400 quando ":numeroRemetenteId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/abc/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.',
    });
    expect(conversasService.listarMensagens).not.toHaveBeenCalled();
  });

  it('404 quando o contato não existe', async () => {
    conversasService.listarMensagens.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/999/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Contato não encontrado.' });
  });

  it('200 — mensagens vazio quando a thread existe mas nunca teve mensagem', async () => {
    conversasService.listarMensagens.mockResolvedValue({ mensagens: [] });

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mensagens: [] });
  });

  it('200 — lista mensagens da thread (contatoId, numeroRemetenteId)', async () => {
    conversasService.listarMensagens.mockResolvedValue({
      mensagens: [
        { id: 1, remetente: 'cliente', corpo: 'oi', criado_em: '2026-08-25T11:00:00.000Z' },
        { id: 2, remetente: 'ia', corpo: 'olá!', criado_em: '2026-08-25T11:01:00.000Z' },
      ],
    });

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body.mensagens).toHaveLength(2);
    expect(conversasService.listarMensagens).toHaveBeenCalledWith(42, 7);
  });

  it('500 quando o service lança erro', async () => {
    conversasService.listarMensagens.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar mensagens do contato.' });
  });
});

describe('POST /api/controle-ligacoes/conversas/:contatoId/:numeroRemetenteId/mensagens', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .send({ corpo: 'oi' });
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/abc/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.',
    });
    expect(conversasService.responder).not.toHaveBeenCalled();
  });

  it('400 quando ":numeroRemetenteId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/abc/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "contatoId" e "numeroRemetenteId" devem ser números inteiros positivos.',
    });
    expect(conversasService.responder).not.toHaveBeenCalled();
  });

  it('400 quando "corpo" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo" é obrigatório.' });
    expect(conversasService.responder).not.toHaveBeenCalled();
  });

  it('400 quando "corpo" é só espaços', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo" é obrigatório.' });
  });

  it('404 quando o contato não existe', async () => {
    conversasService.responder.mockResolvedValue({ status: 'contato_nao_encontrado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/999/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Contato não encontrado.' });
  });

  it('400 quando a thread (contato + número) não tem histórico de conversa', async () => {
    conversasService.responder.mockResolvedValue({ status: 'sem_historico' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Não é possível responder um contato sem histórico de conversa.' });
  });

  it('409 quando o número está desconectado', async () => {
    conversasService.responder.mockResolvedValue({ status: 'numero_desconectado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
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
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Número não possui WhatsApp ativo ou não pôde ser verificado.' });
  });

  it('500 quando o envio falha (falha_envio)', async () => {
    conversasService.responder.mockResolvedValue({ status: 'falha_envio', erro: 'timeout de rede' });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'timeout de rede' });
  });

  it('201 — envia com sucesso e devolve a mensagem gravada, incluindo status_entrega/baileys_message_id', async () => {
    conversasService.responder.mockResolvedValue({
      status: 'enviada',
      mensagem: {
        id: 10,
        remetente: 'colaboradora',
        corpo: 'oi',
        criado_em: '2026-08-25T12:00:00.000Z',
        status_entrega: 'pendente',
        baileys_message_id: 'ALGUM_ID',
      },
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 10,
      remetente: 'colaboradora',
      corpo: 'oi',
      criado_em: '2026-08-25T12:00:00.000Z',
      status_entrega: 'pendente',
      baileys_message_id: 'ALGUM_ID',
    });
    expect(conversasService.responder).toHaveBeenCalledWith(42, 7, 'oi');
  });

  it('500 quando o service lança erro', async () => {
    conversasService.responder.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/controle-ligacoes/conversas/42/7/mensagens')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'oi' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao responder contato.' });
  });
});

describe('GET /api/controle-ligacoes/conversas/stream', () => {
  afterEach(() => {
    mensagensEventsService.removeAllListeners('mensagem-recebida');
    mensagensEventsService.removeAllListeners('mensagem-status-atualizada');
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

  it('repassa "tipoMensagem" quando presente no payload do emit (player de áudio em tempo real)', async () => {
    const resultado = await conectarStream({
      aoConectar: () => {
        mensagensEventsService.emit('mensagem-recebida', {
          contatoId: 42,
          numeroRemetenteId: 17,
          primeiraResposta: true,
          tipoMensagem: 'audio',
        });
      },
      deveEncerrar: (body) => body.includes('\n\n'),
    });

    expect(resultado.body).toBe(
      'event: nova-mensagem\ndata: {"contatoId":42,"numeroRemetenteId":17,"primeiraResposta":true,"tipoMensagem":"audio"}\n\n'
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

  it(
    'registra o listener em "mensagem-status-atualizada", repassa como "event: status-atualizado" ' +
      'e remove o listener ao fechar',
    async () => {
      expect(mensagensEventsService.listenerCount('mensagem-status-atualizada')).toBe(0);
      const onSpy = vi.spyOn(mensagensEventsService, 'on');
      const offSpy = vi.spyOn(mensagensEventsService, 'off');

      const resultado = await conectarStream({
        aoConectar: () => {
          expect(mensagensEventsService.listenerCount('mensagem-status-atualizada')).toBe(1);
          expect(onSpy).toHaveBeenCalledWith('mensagem-status-atualizada', expect.any(Function));
          mensagensEventsService.emit('mensagem-status-atualizada', {
            contatoId: 42,
            numeroRemetenteId: 17,
            baileysMessageId: 'ABC123',
            status: 'entregue',
          });
        },
        deveEncerrar: (body) => body.includes('\n\n'),
      });

      expect(resultado.body).toBe(
        'event: status-atualizado\ndata: {"contatoId":42,"numeroRemetenteId":17,"baileysMessageId":"ABC123","status":"entregue"}\n\n'
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(offSpy).toHaveBeenCalledWith('mensagem-status-atualizada', expect.any(Function));
      expect(mensagensEventsService.listenerCount('mensagem-status-atualizada')).toBe(0);
    }
  );

  it('não emite nada em "mensagem-recebida" quando só "mensagem-status-atualizada" acontece', async () => {
    const resultado = await conectarStream({
      aoConectar: () => {
        mensagensEventsService.emit('mensagem-status-atualizada', {
          contatoId: 1,
          numeroRemetenteId: 2,
          baileysMessageId: 'X',
          status: 'lido',
        });
      },
      deveEncerrar: (body) => body.includes('\n\n'),
    });

    expect(resultado.body).toBe(
      'event: status-atualizado\ndata: {"contatoId":1,"numeroRemetenteId":2,"baileysMessageId":"X","status":"lido"}\n\n'
    );
  });
});

describe('GET /api/controle-ligacoes/conversas/mensagens/:mensagemId/audio', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/conversas/mensagens/10/audio');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/mensagens/10/audio')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":mensagemId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/mensagens/abc/audio')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "mensagemId" deve ser um número inteiro positivo.' });
    expect(conversasService.buscarAudio).not.toHaveBeenCalled();
  });

  it('404 quando o áudio não é encontrado', async () => {
    conversasService.buscarAudio.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/mensagens/999/audio')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Áudio não encontrado.' });
  });

  it('200 — devolve o áudio binário com o Content-Type salvo', async () => {
    const buffer = Buffer.from('fake-audio-bytes');
    conversasService.buscarAudio.mockResolvedValue({ audioDados: buffer, mimetype: 'audio/ogg' });

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/mensagens/10/audio')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio/ogg');
    expect(Buffer.compare(res.body, buffer)).toBe(0);
    expect(conversasService.buscarAudio).toHaveBeenCalledWith(10);
  });

  it('500 quando o service lança erro', async () => {
    conversasService.buscarAudio.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/conversas/mensagens/10/audio')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao buscar áudio da mensagem.' });
  });
});

describe('PUT /api/controle-ligacoes/conversas/:contatoId/:numeroRemetenteId/status', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .send({ status: 'atendeu' });
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ status: 'atendeu' });
    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/abc/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });
    expect(res.status).toBe(400);
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('400 quando ":numeroRemetenteId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/0/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });
    expect(res.status).toBe(400);
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('400 quando "status" está ausente', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "status" inválido ou ausente.' });
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('400 quando "status" não pertence ao enum válido', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'ganhou' });
    expect(res.status).toBe(400);
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('400 quando "motivo" não pertence ao enum MOTIVOS_PERDIDO_VALIDOS', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'perdido', motivo: 'motivo_inventado' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "motivo" inválido.' });
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('400 quando o service devolve o sentinel "motivo_obrigatorio" (status=perdido sem motivo)', async () => {
    conversasService.atualizarStatus.mockResolvedValue('motivo_obrigatorio');

    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'perdido' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "motivo" é obrigatório quando o status é "perdido".' });
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(1, 2, 'perdido', null, null);
  });

  it('200 — status=perdido com motivo/motivoDetalhe válidos', async () => {
    conversasService.atualizarStatus.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'perdido', motivo: 'preco_condicao', motivoDetalhe: 'Achou caro' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ contatoId: 1, numeroRemetenteId: 2, status: 'perdido' });
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(1, 2, 'perdido', 'preco_condicao', 'Achou caro');
  });

  it('400 — o controller valida "motivo" contra o enum sempre que presente, mesmo fora de status=perdido (comportamento real, não o "deveria")', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'venda', motivo: 'nao_faz_sentido_aqui' });

    expect(res.status).toBe(400);
    expect(conversasService.atualizarStatus).not.toHaveBeenCalled();
  });

  it('200 — status="venda" sem motivo nenhum grava motivo/motivoDetalhe como null', async () => {
    conversasService.atualizarStatus.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'venda' });

    expect(res.status).toBe(200);
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(1, 2, 'venda', null, null);
  });

  it('400 — status="atendeu" definido manualmente via PUT é bloqueado pelo backend com a mensagem exata', async () => {
    conversasService.atualizarStatus.mockResolvedValue('atendeu_nao_permitido');

    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "O status 'Atendeu' é definido automaticamente pelo sistema e não pode ser selecionado manualmente.",
    });
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(1, 2, 'atendeu', null, null);
  });

  it('400 — o bloqueio de status="atendeu" é incondicional, valendo tanto para thread sem status (null) quanto para thread que já tem outro status', async () => {
    conversasService.atualizarStatus.mockResolvedValue('atendeu_nao_permitido');

    const resSemStatusAnterior = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });

    const resComStatusAnterior = await request(app)
      .put('/api/controle-ligacoes/conversas/3/4/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });

    expect(resSemStatusAnterior.status).toBe(400);
    expect(resComStatusAnterior.status).toBe(400);
    expect(resSemStatusAnterior.body).toEqual({
      error: "O status 'Atendeu' é definido automaticamente pelo sistema e não pode ser selecionado manualmente.",
    });
    expect(resComStatusAnterior.body).toEqual({
      error: "O status 'Atendeu' é definido automaticamente pelo sistema e não pode ser selecionado manualmente.",
    });
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(1, 2, 'atendeu', null, null);
    expect(conversasService.atualizarStatus).toHaveBeenCalledWith(3, 4, 'atendeu', null, null);
  });

  it('500 quando o service lança erro', async () => {
    conversasService.atualizarStatus.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .put('/api/controle-ligacoes/conversas/1/2/status')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ status: 'atendeu' });

    expect(res.status).toBe(500);
  });
});

describe('GET /api/controle-ligacoes/pipeline', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/pipeline');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);
    expect(res.status).toBe(403);
  });

  it('400 quando "numeroRemetenteId" está em formato inválido', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline?numeroRemetenteId=abc')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(400);
    expect(conversasService.listarPipeline).not.toHaveBeenCalled();
  });

  it('200 — repassa busca/numeroRemetenteId/statusInicio/statusFim/disparoInicio/disparoFim para o service', async () => {
    conversasService.listarPipeline.mockResolvedValue([
      { contato_id: 1, nome: 'Ana', telefone: '5598900000000', numero_remetente_id: 2, apelido: 'Bruno', status: 'perdido', atualizado_em: '2026-08-01T00:00:00.000Z', motivo: 'preco_condicao', motivoDetalhe: null },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline?busca=Ana&numeroRemetenteId=2&statusInicio=2026-08-01&statusFim=2026-08-31&disparoInicio=2026-07-01&disparoFim=2026-07-31')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(conversasService.listarPipeline).toHaveBeenCalledWith({
      busca: 'Ana',
      numeroRemetenteId: 2,
      statusInicio: '2026-08-01',
      statusFim: '2026-08-31',
      disparoInicio: '2026-07-01',
      disparoFim: '2026-07-31',
    });
    expect(res.body[0].motivoDetalhe).toBeNull();
  });

  it('200 — lista vazia quando nada tem status atribuído', async () => {
    conversasService.listarPipeline.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('500 quando o service lança erro', async () => {
    conversasService.listarPipeline.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/controle-ligacoes/pipeline/:contatoId/:numeroRemetenteId/historico', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/pipeline/1/2/historico');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline/1/2/historico')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);
    expect(res.status).toBe(403);
  });

  it('400 quando ":contatoId" ou ":numeroRemetenteId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline/abc/2/historico')
      .set('Authorization', `Bearer ${tokenFor()}`);
    expect(res.status).toBe(400);
    expect(conversasService.listarHistoricoStatus).not.toHaveBeenCalled();
  });

  it('200 — devolve o histórico ordenado como o service devolve (mais recente primeiro)', async () => {
    conversasService.listarHistoricoStatus.mockResolvedValue([
      { status_anterior: 'atendeu', status_novo: 'perdido', origem: 'atendente', motivo: 'preco_condicao', motivo_detalhe: null, alterado_em: '2026-08-02T00:00:00.000Z' },
      { status_anterior: null, status_novo: 'atendeu', origem: 'sistema', motivo: null, motivo_detalhe: null, alterado_em: '2026-08-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline/1/2/historico')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(conversasService.listarHistoricoStatus).toHaveBeenCalledWith(1, 2);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].status_novo).toBe('perdido');
  });

  it('500 quando o service lança erro', async () => {
    conversasService.listarHistoricoStatus.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/pipeline/1/2/historico')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});
