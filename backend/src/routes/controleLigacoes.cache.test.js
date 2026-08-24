
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

describe('GET /api/controle-ligacoes/* — cache/ETag desabilitado', () => {
  it('resposta inclui Cache-Control: no-store', async () => {
    estadosModel.listEstadosComDDDs.mockResolvedValue([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('reenviar o ETag de uma resposta anterior como If-None-Match continua devolvendo 200 com o corpo completo, nunca 304', async () => {
    estadosModel.listEstadosComDDDs.mockResolvedValue([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' },
    ]);

    const token = tokenFor();

    const primeira = await request(app)
      .get('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${token}`);

    expect(primeira.status).toBe(200);
    // Reproduz o bug original: o Express (via app.set('etag', 'weak'), default
    // global não sobrescrito) ainda computa um ETag pra resposta — a correção
    // não é impedir esse cálculo, é impedir que ele resulte em 304.
    expect(primeira.headers.etag).toBeDefined();

    // Simula exatamente o cenário do bug de produção: o cliente guardou o
    // ETag da resposta anterior e reenvia como If-None-Match — antes da
    // correção, isso fazia o Express responder 304 com corpo vazio.
    const segunda = await request(app)
      .get('/api/controle-ligacoes/estados')
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', primeira.headers.etag);

    expect(segunda.status).toBe(200);
    expect(segunda.body).toEqual([
      { id: 6, nome: 'Maranhão', uf: 'MA', ddds: ['98', '99'], criado_em: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
