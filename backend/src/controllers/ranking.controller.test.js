// Testes de integração de rota (Supertest, sem subir o servidor de verdade,
// sem tocar o Azure SQL real) para a feature "ocultar rede" (campo
// `Redes.visivel`), cobrindo:
//   - GET  /api/ranking/redes   (shape com `visivel`)
//   - PUT  /api/ranking/redes/:id (aceitar/validar `visivel`, sem regressão
//     nos campos `nome`/`responsavel` já existentes)
//   - autenticação (401 sem token / token inválido)
//   - o fato de que a rota NÃO tem nenhuma checagem de admin no backend
//     (achado de QA, ver relatório final).
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

describe('GET /api/ranking/redes', () => {
  it('retorna 401 sem header Authorization', async () => {
    const res = await request(app).get('/api/ranking/redes');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação não informado.' });
  });

  it('retorna 401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/ranking/redes')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação inválido ou expirado.' });
  });

  it('200 — retorna as redes com o campo "visivel" no shape, autenticado', async () => {
    rankingModel.listRedesComLojas.mockResolvedValue([
      { id: 1, nome: 'Rede A', responsavel: { id: 3, nome: 'Fulano' }, visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [] },
      { id: 2, nome: 'Rede B', responsavel: null, visivel: false, criado_em: '2024-01-02T00:00:00.000Z', lojas: [] },
    ]);

    const res = await request(app)
      .get('/api/ranking/redes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('visivel', true);
    expect(res.body[0].responsavel).toEqual({ id: 3, nome: 'Fulano' });
    expect(res.body[1]).toHaveProperty('visivel', false);
    expect(res.body[1].responsavel).toBeNull();
  });

  it('500 quando o model lança erro (ex: coluna/dependência de banco indisponível)', async () => {
    rankingModel.listRedesComLojas.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .get('/api/ranking/redes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar redes.' });
  });
});

describe('PUT /api/ranking/redes/:id — campo "visivel"', () => {
  it('aceita visivel:false e repassa ao model junto com o restante do fluxo', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: null, visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: null, visivel: false, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: false });

    expect(res.status).toBe(200);
    expect(res.body.visivel).toBe(false);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavelId: undefined, visivel: false });
    // nome não foi enviado, então a checagem de duplicidade não deve rodar
    expect(rankingModel.existeRedeComNome).not.toHaveBeenCalled();
  });

  it('aceita visivel:true e repassa ao model', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: null, visivel: false });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: null, visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: true });

    expect(res.status).toBe(200);
    expect(res.body.visivel).toBe(true);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavelId: undefined, visivel: true });
  });

  it.each([
    ['string "true"', 'true'],
    ['number 1', 1],
    ['number 0', 0],
    ['null', null],
  ])('400 quando visivel é %s (não é booleano estrito)', async (_label, valorInvalido) => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: valorInvalido });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "visivel", quando enviado, deve ser "true" ou "false".',
    });
  });

  it('400 — corpo vazio (nenhum de nome/responsavelId/visivel), mensagem atualizada', async () => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Informe ao menos um campo ("nome", "responsavelId" ou "visivel") para atualizar.',
    });
  });

  it('404 quando a rede não existe', async () => {
    rankingModel.findRedeById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/ranking/redes/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: false });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Rede não encontrada.' });
  });

  it('401 sem token, mesmo com body válido', async () => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .send({ visivel: false });

    expect(res.status).toBe(401);
  });

  // ACHADO DE QA: a rota PUT /api/ranking/redes/:id não tem adminMiddleware
  // nenhum (nem em ranking.routes.js, nem no mount de app.js, nem dentro do
  // controller) — "restrito a admin" hoje só existe na UI (botão escondido
  // em RankingPage.jsx quando isAdmin é false). Um usuário autenticado
  // comum, chamando a API diretamente, consegue ocultar/mostrar qualquer
  // rede. Este teste documenta o comportamento ATUAL (não o desejado) —
  // ver veredito final.
  it('[ACHADO DE QA] usuário autenticado NÃO-admin também consegue alterar "visivel" (sem 403)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: null, visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: null, visivel: false, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`)
      .send({ visivel: false });

    // Comportamento atual: 200 (deveria ser 403 se a regra de negócio for
    // "restrito a admin" também no backend).
    expect(res.status).toBe(200);
  });

  // --- regressão: nome continua funcionando como antes ---
  it('regressão: continua aceitando atualizar somente "nome"', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Antigo', responsavel: null, visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(false);
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Novo Nome', responsavel: null, visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Novo Nome');
    expect(rankingModel.existeRedeComNome).toHaveBeenCalledWith('Novo Nome', 5);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: 'Novo Nome', responsavelId: undefined, visivel: undefined });
  });

  it('regressão: 409 quando o novo nome já existe em outra rede', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Antigo', responsavel: null, visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(true);

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Nome Duplicado' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe uma rede com esse nome.' });
  });

  it('regressão: 400 quando nome enviado é string vazia/só espaços', async () => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome", quando enviado, não pode ser vazio.' });
  });
});

describe('PUT /api/ranking/redes/:id — campo "responsavelId"', () => {
  it('aceita responsavelId numérico e repassa ao model, retornando responsavel como objeto', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: null, visivel: true });
    rankingModel.existeResponsavel.mockResolvedValue(true);
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: { id: 4, nome: 'Ciclana da Silva' }, visivel: true,
      criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ responsavelId: 4 });

    expect(res.status).toBe(200);
    expect(res.body.responsavel).toEqual({ id: 4, nome: 'Ciclana da Silva' });
    expect(rankingModel.existeResponsavel).toHaveBeenCalledWith(4);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavelId: 4, visivel: undefined });
  });

  it('aceita responsavelId: null para remover a atribuição (não checa existência)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: { id: 4, nome: 'Ciclana' }, visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: null, visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ responsavelId: null });

    expect(res.status).toBe(200);
    expect(res.body.responsavel).toBeNull();
    expect(rankingModel.existeResponsavel).not.toHaveBeenCalled();
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavelId: null, visivel: undefined });
  });

  it.each([
    ['string não numérica', 'abc'],
    ['zero', 0],
    ['negativo', -1],
    ['decimal', 1.5],
  ])('400 quando responsavelId é %s (não é inteiro positivo nem null)', async (_label, valorInvalido) => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ responsavelId: valorInvalido });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "responsavelId", quando enviado, deve ser um número inteiro positivo ou null.',
    });
  });

  it('400 quando responsavelId é inteiro positivo mas não existe em Responsaveis', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: null, visivel: true });
    rankingModel.existeResponsavel.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ responsavelId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Responsável informado não existe.' });
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });
});

describe('GET /api/ranking/responsaveis', () => {
  it('retorna 401 sem header Authorization', async () => {
    const res = await request(app).get('/api/ranking/responsaveis');
    expect(res.status).toBe(401);
  });

  it('200 — lista responsáveis para qualquer usuário autenticado (não exige admin)', async () => {
    rankingModel.listResponsaveis.mockResolvedValue([
      { id: 3, nome: 'Fulano de Tal', criado_em: '2026-07-20T12:00:00.000Z' },
      { id: 4, nome: 'Ciclana da Silva', criado_em: '2026-07-20T12:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({ id: 3, nome: 'Fulano de Tal', criado_em: '2026-07-20T12:00:00.000Z' });
  });

  it('500 quando o model lança erro', async () => {
    rankingModel.listResponsaveis.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .get('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar responsáveis.' });
  });
});

describe('POST /api/ranking/responsaveis', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/ranking/responsaveis').send({ nome: 'Beltrano' });
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário autenticado não é admin', async () => {
    const res = await request(app)
      .post('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`)
      .send({ nome: 'Beltrano' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito a administradores.' });
    expect(rankingModel.insertResponsavel).not.toHaveBeenCalled();
  });

  it('400 quando nome está ausente/vazio', async () => {
    const res = await request(app)
      .post('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`)
      .send({ nome: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome" é obrigatório e não pode ser vazio.' });
  });

  it('409 quando já existe um responsável com esse nome', async () => {
    rankingModel.existeResponsavelComNome.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`)
      .send({ nome: 'Beltrano' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe um responsável com esse nome.' });
  });

  it('201 — cria responsável quando o usuário é admin e o nome é válido', async () => {
    rankingModel.existeResponsavelComNome.mockResolvedValue(false);
    rankingModel.insertResponsavel.mockResolvedValue({
      id: 5, nome: 'Beltrano', criado_em: '2026-07-22T10:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/ranking/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`)
      .send({ nome: 'Beltrano' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 5, nome: 'Beltrano', criado_em: '2026-07-22T10:00:00.000Z' });
  });
});

describe('DELETE /api/ranking/responsaveis/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/ranking/responsaveis/5');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário autenticado não é admin', async () => {
    const res = await request(app)
      .delete('/api/ranking/responsaveis/5')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito a administradores.' });
    expect(rankingModel.deleteResponsavelIfNoRedes).not.toHaveBeenCalled();
  });

  it('400 quando :id não é inteiro positivo', async () => {
    const res = await request(app)
      .delete('/api/ranking/responsaveis/abc')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('404 quando o responsável não existe', async () => {
    rankingModel.deleteResponsavelIfNoRedes.mockResolvedValue('not_found');

    const res = await request(app)
      .delete('/api/ranking/responsaveis/999')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Responsável não encontrado.' });
  });

  it('409 quando há redes vinculadas ao responsável', async () => {
    rankingModel.deleteResponsavelIfNoRedes.mockResolvedValue('has_redes');

    const res = await request(app)
      .delete('/api/ranking/responsaveis/5')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir este responsável pois há redes vinculadas a ele. Remova a atribuição primeiro.',
    });
  });

  it('204 — exclui com sucesso quando o usuário é admin e não há redes vinculadas', async () => {
    rankingModel.deleteResponsavelIfNoRedes.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/ranking/responsaveis/5')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });
});
