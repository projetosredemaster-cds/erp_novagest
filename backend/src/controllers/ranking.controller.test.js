// Testes de integração de rota (Supertest, sem subir o servidor de verdade,
// sem tocar o Azure SQL real) para o módulo Ranking (Entradas/Categorias —
// ver CONTRATO-RANKING-API.md). CRUD de Diretor/Rede/Responsavel foi
// extraído para o módulo Cadastros (ver cadastros.controller.test.js) e não
// é mais coberto aqui. Cobre:
//   - GET/POST     /api/ranking/entradas
//   - autenticação (401 sem token / token inválido)
//
// NOTA DE IMPLEMENTAÇÃO — por que `require()` (CJS puro) em vez de `import`:
// `vi.mock('../models/ranking.model', factory)` com sintaxe `import` só
// intercepta o require feito DENTRO do próprio arquivo de teste; como
// `ranking.service.js`/`ranking.controller.js`/`app.js` são CommonJS puro
// (sem `import`/`export`), o require interno deles não passa pelo grafo de
// módulos do Vite e continua resolvendo para o model REAL — confirmado
// experimentalmente: com `vi.mock`, uma chamada apontou de fato para o
// Azure SQL real ("Invalid column name 'visivel'"), o que é uma violação
// direta da regra "nunca testar contra produção" (ver nota no relatório
// final de QA). A alternativa segura usada aqui é obter a MESMA referência
// de objeto que `ranking.service.js` usa (garantida pelo cache de módulos
// do Node, que é compartilhado entre requires em CJS puro) e sobrescrever
// cada método com `vi.spyOn(...).mockImplementation(...)` — isso funciona
// porque o objeto é mutado por referência, não depende do grafo do Vite.
//
// Rede de segurança: todo método do model recebe, por padrão, uma
// implementação-guarda que lança erro se for chamada sem um mock explícito
// no teste — qualquer teste que acidentalmente dependa de um método não
// mockado falha ALTO E CLARO em vez de silenciosamente tentar uma conexão
// real com o Azure SQL de produção.

const request = require('supertest');
const jwt = require('jsonwebtoken');
const rankingModel = require('../models/ranking.model');
const app = require('../app');

function tokenFor({ isAdmin = false } = {}) {
  return jwt.sign(
    { id: 1, email: 'user@teste.com', isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // guarda: qualquer método do model chamado sem mock explícito no teste
  // lança, em vez de tentar se conectar ao Azure SQL real.
  for (const key of Object.keys(rankingModel)) {
    if (typeof rankingModel[key] === 'function') {
      vi.spyOn(rankingModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] ranking.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/ranking/entradas — campo "redeId"', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/ranking/entradas?data=2026-07-27&categoriaId=1');
    expect(res.status).toBe(401);
  });

  it('200 — retorna entradas com rede_id no shape', async () => {
    rankingModel.listEntradas.mockResolvedValue([
      { id: 101, data_ref: '2026-07-17T00:00:00.000Z', categoria_id: 1, rede_id: 5, valor: 15230.5, atualizado_em: '2026-07-17T14:22:01.000Z', rede_nome: 'Delta', rede_emoji: '🔺', diretor_id: 1 },
    ]);

    const res = await request(app)
      .get('/api/ranking/entradas?data=2026-07-17&categoriaId=1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).toHaveProperty('rede_id', 5);
    expect(rankingModel.listEntradas).toHaveBeenCalledWith({ data: '2026-07-17', categoriaId: 1 });
  });

  it('400 quando data está no formato errado', async () => {
    const res = await request(app)
      .get('/api/ranking/entradas?data=17-07-2026&categoriaId=1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando categoriaId está ausente/inválido', async () => {
    const res = await request(app)
      .get('/api/ranking/entradas?data=2026-07-17')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetro "categoriaId" é obrigatório e deve ser um número inteiro positivo.',
    });
  });
});

describe('POST /api/ranking/entradas — campo "redeId" (upsert)', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/ranking/entradas')
      .send({ data: '2026-07-27', categoriaId: 1, redeId: 5, valor: 100 });
    expect(res.status).toBe(401);
  });

  it('400 quando data está ausente/no formato errado', async () => {
    const res = await request(app)
      .post('/api/ranking/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ categoriaId: 1, redeId: 5, valor: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando categoriaId está ausente/inválido', async () => {
    const res = await request(app)
      .post('/api/ranking/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ data: '2026-07-27', redeId: 5, valor: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "categoriaId" é obrigatório e deve ser um número inteiro positivo.',
    });
  });

  it('400 quando redeId está ausente/inválido (era "lojaId" no contrato antigo)', async () => {
    const res = await request(app)
      .post('/api/ranking/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ data: '2026-07-27', categoriaId: 1, valor: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "redeId" é obrigatório e deve ser um número inteiro positivo.',
    });
  });

  it('400 quando valor está ausente/negativo', async () => {
    const res = await request(app)
      .post('/api/ranking/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ data: '2026-07-27', categoriaId: 1, redeId: 5, valor: -10 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "valor" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('200 — upsert bem-sucedido repassa redeId ao service/model', async () => {
    rankingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 101, data_ref: '2026-07-17T00:00:00.000Z',
      categoria_id: 1, rede_id: 5, valor: 15230.5, atualizado_em: '2026-07-17T14:22:01.000Z',
    });

    const res = await request(app)
      .post('/api/ranking/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 15230.5 });

    expect(res.status).toBe(200);
    expect(res.body.rede_id).toBe(5);
    expect(rankingModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 15230.5,
    });
  });
});
