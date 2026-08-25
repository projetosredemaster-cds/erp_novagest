
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

describe('GET /api/ranking/categorias', () => {
  it('401 sem header Authorization', async () => {
    const res = await request(app).get('/api/ranking/categorias');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação não informado.' });
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/ranking/categorias')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  it('200 — retorna todas as categorias, inclusive ocultas (visivel:false), com padrao/visivel no shape', async () => {
    rankingModel.listCategorias.mockResolvedValue([
      { id: 1, nome: 'Receita Bruta', principal: true, padrao: true, visivel: true, criado_em: '2024-01-01T00:00:00.000Z' },
      { id: 2, nome: 'Correção', principal: false, padrao: true, visivel: true, criado_em: '2024-01-01T00:00:00.000Z' },
      { id: 3, nome: 'Acessórios', principal: false, padrao: true, visivel: true, criado_em: '2024-01-01T00:00:00.000Z' },
      { id: 4, nome: 'Oculta de Teste', principal: false, padrao: false, visivel: false, criado_em: '2026-07-20T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.filter((c) => c.padrao)).toHaveLength(3);
    expect(res.body.find((c) => c.id === 4)).toMatchObject({ visivel: false, padrao: false });
  });

  it('500 quando o model lança erro', async () => {
    rankingModel.listCategorias.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .get('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar categorias.' });
  });
});

describe('POST /api/ranking/categorias', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/ranking/categorias').send({ nome: 'Nova' });
    expect(res.status).toBe(401);
  });

  it('400 quando nome está ausente/vazio', async () => {
    const res = await request(app)
      .post('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome" é obrigatório e não pode ser vazio.' });
    expect(rankingModel.existeCategoriaComNome).not.toHaveBeenCalled();
  });

  it('409 quando já existe uma categoria com esse nome (case-insensitive)', async () => {
    rankingModel.existeCategoriaComNome.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'receita bruta' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe uma categoria com esse nome.' });
    expect(rankingModel.insertCategoria).not.toHaveBeenCalled();
  });

  it('201 — cria a categoria sempre com padrao:false, principal:false, visivel:true', async () => {
    rankingModel.existeCategoriaComNome.mockResolvedValue(false);
    rankingModel.insertCategoria.mockResolvedValue({
      id: 5, nome: 'Categoria Teste QA', principal: false, padrao: false, visivel: true,
      criado_em: '2026-07-28T10:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Categoria Teste QA' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 5, nome: 'Categoria Teste QA', principal: false, padrao: false, visivel: true,
      criado_em: '2026-07-28T10:00:00.000Z',
    });
    expect(rankingModel.insertCategoria).toHaveBeenCalledWith({ nome: 'Categoria Teste QA' });
  });

  it('500 quando o model lança erro', async () => {
    rankingModel.existeCategoriaComNome.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .post('/api/ranking/categorias')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Categoria Teste QA' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao criar categoria.' });
  });
});

describe('PUT /api/ranking/categorias/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).put('/api/ranking/categorias/1').send({ nome: 'X' });
    expect(res.status).toBe(401);
  });

  it('400 quando :id não é inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/ranking/categorias/abc')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('400 quando nome enviado é string vazia/só espaços', async () => {
    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome", quando enviado, não pode ser vazio.' });
  });

  it('400 quando visivel enviado não é booleano estrito', async () => {
    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: 'false' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "visivel", quando enviado, deve ser "true" ou "false".' });
  });

  it('404 quando a categoria não existe', async () => {
    rankingModel.findCategoriaById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/ranking/categorias/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Categoria não encontrada.' });
  });

  it('409 quando o novo nome já pertence a outra categoria', async () => {
    rankingModel.findCategoriaById.mockResolvedValue({ id: 4, nome: 'Atual', padrao: false, principal: false, visivel: true });
    rankingModel.existeCategoriaComNome.mockResolvedValue(true);

    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Nome Duplicado' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe uma categoria com esse nome.' });
    expect(rankingModel.updateCategoria).not.toHaveBeenCalled();
  });

  it('200 — atualiza nome e visivel com sucesso', async () => {
    rankingModel.findCategoriaById
      .mockResolvedValueOnce({ id: 4, nome: 'Antigo', padrao: false, principal: false, visivel: true })
      .mockResolvedValueOnce({ id: 4, nome: 'Novo Nome', padrao: false, principal: false, visivel: false, criado_em: '2026-07-20T00:00:00.000Z' });
    rankingModel.existeCategoriaComNome.mockResolvedValue(false);
    rankingModel.updateCategoria.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Novo Nome', visivel: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 4, nome: 'Novo Nome', padrao: false, principal: false, visivel: false, criado_em: '2026-07-20T00:00:00.000Z',
    });
    expect(rankingModel.existeCategoriaComNome).toHaveBeenCalledWith('Novo Nome', 4);
    expect(rankingModel.updateCategoria).toHaveBeenCalledWith(4, { nome: 'Novo Nome', visivel: false });
  });

  it('ACHADO DE QA: enviar padrao/principal no corpo é ignorado silenciosamente (não altera esses campos)', async () => {
    rankingModel.findCategoriaById
      .mockResolvedValueOnce({ id: 1, nome: 'Receita Bruta', padrao: true, principal: true, visivel: true })
      .mockResolvedValueOnce({ id: 1, nome: 'Receita Bruta Renomeada', padrao: true, principal: true, visivel: true, criado_em: '2024-01-01T00:00:00.000Z' });
    rankingModel.existeCategoriaComNome.mockResolvedValue(false);
    rankingModel.updateCategoria.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/ranking/categorias/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Receita Bruta Renomeada', padrao: false, principal: false });

    expect(res.status).toBe(200);
    expect(rankingModel.updateCategoria).toHaveBeenCalledWith(1, { nome: 'Receita Bruta Renomeada', visivel: undefined });
    expect(res.body.padrao).toBe(true);
    expect(res.body.principal).toBe(true);
  });

  it('ACHADO DE QA: corpo vazio NÃO retorna 400 (diferente do documentado no plano de teste / do padrão usado em PUT redes e lojas) — vira um no-op 200', async () => {
    rankingModel.findCategoriaById
      .mockResolvedValueOnce({ id: 4, nome: 'Categoria X', padrao: false, principal: false, visivel: true })
      .mockResolvedValueOnce({ id: 4, nome: 'Categoria X', padrao: false, principal: false, visivel: true, criado_em: '2026-07-20T00:00:00.000Z' });
    rankingModel.updateCategoria.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(rankingModel.existeCategoriaComNome).not.toHaveBeenCalled();
    expect(rankingModel.updateCategoria).toHaveBeenCalledWith(4, { nome: undefined, visivel: undefined });
  });

  it('500 quando o model lança erro', async () => {
    rankingModel.findCategoriaById.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .put('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'X' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao atualizar categoria.' });
  });
});

describe('DELETE /api/ranking/categorias/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/ranking/categorias/4');
    expect(res.status).toBe(401);
  });

  it('400 quando :id não é inteiro positivo', async () => {
    const res = await request(app)
      .delete('/api/ranking/categorias/abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('404 quando a categoria não existe', async () => {
    rankingModel.deleteCategoriaIfAllowed.mockResolvedValue('not_found');

    const res = await request(app)
      .delete('/api/ranking/categorias/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Categoria não encontrada.' });
  });

  it('409 quando a categoria é padrão (mensagem exata do contrato)', async () => {
    rankingModel.deleteCategoriaIfAllowed.mockResolvedValue('is_padrao');

    const res = await request(app)
      .delete('/api/ranking/categorias/1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir uma categoria padrão do sistema. Utilize a opção de ocultar.',
    });
  });

  it('409 quando existem lançamentos vinculados (mensagem exata do contrato)', async () => {
    rankingModel.deleteCategoriaIfAllowed.mockResolvedValue('has_entradas');

    const res = await request(app)
      .delete('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir esta categoria pois existem lançamentos vinculados a ela.',
    });
  });

  it('204 — exclui com sucesso quando não-padrão e sem lançamentos', async () => {
    rankingModel.deleteCategoriaIfAllowed.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it('500 quando o model lança erro', async () => {
    rankingModel.deleteCategoriaIfAllowed.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .delete('/api/ranking/categorias/4')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao excluir categoria.' });
  });
});
