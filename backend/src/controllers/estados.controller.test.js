
const request = require('supertest');
const jwt = require('jsonwebtoken');
const estadosModel = require('../models/estados.model');
const app = require('../app');

function tokenFor({ role = 'operador_cobranca' } = {}) {
  return jwt.sign(
    { id: 1, email: 'liv@teste.com', isAdmin: false, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(estadosModel)) {
    if (typeof estadosModel[key] === 'function') {
      vi.spyOn(estadosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] estados.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/estados', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/estados');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito ao Controle de Ligações.' });
  });

  it('200 — lista estados com ddds', async () => {
    estadosModel.listEstadosComDDDs.mockResolvedValue([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

describe('POST /api/controle-ligacoes/estados', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .send({ nome: 'Maranhão', uf: 'MA', ddds: ['98'] });

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`)
      .send({ nome: 'Maranhão', uf: 'MA', ddds: ['98'] });

    expect(res.status).toBe(403);
  });

  it('400 quando "nome" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ uf: 'MA', ddds: ['98'] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome" é obrigatório.' });
  });

  it('400 quando "uf" não tem 2 letras', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Maranhão', uf: 'MAR', ddds: ['98'] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "uf" é obrigatório e deve ter 2 letras.',
    });
  });

  it('400 quando "ddds" está vazio', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Maranhão', uf: 'MA', ddds: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "ddds" é obrigatório e deve conter ao menos um DDD válido.',
    });
  });

  it('409 quando a UF já está cadastrada', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({ status: 'uf_duplicada' });

    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Maranhão', uf: 'MA', ddds: ['98'] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe um estado com essa UF.' });
  });

  it('409 quando algum DDD já pertence a outro estado — mensagem exata', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({
      status: 'ddd_duplicado',
      ddd: '98',
      estadoNome: 'Maranhão',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Novo Estado', uf: 'NE', ddds: ['98'] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'O DDD "98" já está atribuído ao estado "Maranhão".',
    });
  });

  it('201 — cria o estado com sucesso', async () => {
    estadosModel.criarEstadoComDDDs.mockResolvedValue({
      status: 'criado',
      estado: { id: 7, nome: 'Bahia', uf: 'BA', ddds: ['71'], criado_em: '2026-01-01T00:00:00.000Z' },
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Bahia', uf: 'ba', ddds: ['71'] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 7, nome: 'Bahia', uf: 'BA', ddds: ['71'], criado_em: '2026-01-01T00:00:00.000Z' });
  });
});
