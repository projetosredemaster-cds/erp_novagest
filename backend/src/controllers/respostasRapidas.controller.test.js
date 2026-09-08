
const request = require('supertest');
const jwt = require('jsonwebtoken');
const respostasRapidasModel = require('../models/respostasRapidas.model');
const app = require('../app');

function tokenFor({ role = 'operador_cobranca', isAdmin = false } = {}) {
  return jwt.sign(
    { id: 1, email: 'liv@teste.com', isAdmin, role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(respostasRapidasModel)) {
    if (typeof respostasRapidasModel[key] === 'function') {
      vi.spyOn(respostasRapidasModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] respostasRapidas.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/respostas-rapidas', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/respostas-rapidas');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('200 — lista respostas rápidas ativas', async () => {
    respostasRapidasModel.listAtivas.mockResolvedValue([
      { id: 1, titulo: 'Saudação', corpo: 'Olá, tudo bem?', ordem: 0, ativo: true, criadoEm: '2026-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, titulo: 'Saudação', corpo: 'Olá, tudo bem?', ordem: 0, ativo: true, criadoEm: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('500 quando o model lança erro', async () => {
    respostasRapidasModel.listAtivas.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .get('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/controle-ligacoes/respostas-rapidas', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .send({ titulo: 'Saudação', corpo: 'Olá' });

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ titulo: 'Saudação', corpo: 'Olá' });

    expect(res.status).toBe(403);
  });

  it('400 quando "titulo" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: 'Olá, tudo bem?' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "titulo" é obrigatório.' });
    expect(respostasRapidasModel.insertResposta).not.toHaveBeenCalled();
  });

  it('400 quando "titulo" é string vazia/só espaços', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: '   ', corpo: 'Olá, tudo bem?' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "titulo" é obrigatório.' });
  });

  it('400 quando "corpo" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Saudação' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo" é obrigatório.' });
    expect(respostasRapidasModel.insertResposta).not.toHaveBeenCalled();
  });

  it('400 quando "ordem" enviado não é um inteiro', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Saudação', corpo: 'Olá, tudo bem?', ordem: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "ordem", quando enviado, deve ser um número inteiro.' });
    expect(respostasRapidasModel.insertResposta).not.toHaveBeenCalled();
  });

  it('201 — cria com ordem default 0 quando ausente', async () => {
    respostasRapidasModel.insertResposta.mockResolvedValue({
      id: 5, titulo: 'Saudação', corpo: 'Olá, tudo bem?', ordem: 0, ativo: true, criadoEm: '2026-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Saudação', corpo: 'Olá, tudo bem?' });

    expect(res.status).toBe(201);
    expect(res.body.ordem).toBe(0);
    expect(respostasRapidasModel.insertResposta).toHaveBeenCalledWith({
      titulo: 'Saudação', corpo: 'Olá, tudo bem?', ordem: 0,
    });
  });

  it('201 — cria com ordem informada e faz trim de titulo/corpo', async () => {
    respostasRapidasModel.insertResposta.mockResolvedValue({
      id: 6, titulo: 'Despedida', corpo: 'Até mais!', ordem: 3, ativo: true, criadoEm: '2026-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: '  Despedida  ', corpo: '  Até mais!  ', ordem: 3 });

    expect(res.status).toBe(201);
    expect(respostasRapidasModel.insertResposta).toHaveBeenCalledWith({
      titulo: 'Despedida', corpo: 'Até mais!', ordem: 3,
    });
  });

  it('500 quando o model lança erro', async () => {
    respostasRapidasModel.insertResposta.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .post('/api/controle-ligacoes/respostas-rapidas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Saudação', corpo: 'Olá, tudo bem?' });

    expect(res.status).toBe(500);
  });
});

describe('PUT /api/controle-ligacoes/respostas-rapidas/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .send({ titulo: 'Novo título' });

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`)
      .send({ titulo: 'Novo título' });

    expect(res.status).toBe(403);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/abc')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Novo título' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('400 quando nenhum campo é enviado', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Informe ao menos um campo para atualizar.' });
    expect(respostasRapidasModel.findById).not.toHaveBeenCalled();
  });

  it('400 quando "titulo" enviado é vazio', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: '   ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "titulo", quando enviado, não pode ser vazio.' });
  });

  it('400 quando "corpo" enviado é vazio', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ corpo: '' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "corpo", quando enviado, não pode ser vazio.' });
  });

  it('400 quando "ordem" enviado não é um inteiro', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ordem: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "ordem", quando enviado, deve ser um número inteiro.' });
  });

  it('400 quando "ativo" enviado não é boolean', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ativo: 'sim' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".' });
  });

  it('404 quando a resposta não existe', async () => {
    respostasRapidasModel.findById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Novo título' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Resposta rápida não encontrada.' });
    expect(respostasRapidasModel.updateResposta).not.toHaveBeenCalled();
  });

  it('200 — atualização parcial (só titulo) com sucesso', async () => {
    respostasRapidasModel.findById
      .mockResolvedValueOnce({ id: 1, titulo: 'Antigo', corpo: 'Olá', ordem: 0, ativo: true })
      .mockResolvedValueOnce({ id: 1, titulo: 'Novo título', corpo: 'Olá', ordem: 0, ativo: true });
    respostasRapidasModel.updateResposta.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: '  Novo título  ' });

    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('Novo título');
    expect(respostasRapidasModel.updateResposta).toHaveBeenCalledWith(1, {
      titulo: 'Novo título', corpo: undefined, ordem: undefined, ativo: undefined,
    });
  });

  it('200 — atualização parcial (ativo:false) com sucesso', async () => {
    respostasRapidasModel.findById
      .mockResolvedValueOnce({ id: 1, titulo: 'Saudação', corpo: 'Olá', ordem: 0, ativo: true })
      .mockResolvedValueOnce({ id: 1, titulo: 'Saudação', corpo: 'Olá', ordem: 0, ativo: false });
    respostasRapidasModel.updateResposta.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ativo: false });

    expect(res.status).toBe(200);
    expect(res.body.ativo).toBe(false);
    expect(respostasRapidasModel.updateResposta).toHaveBeenCalledWith(1, {
      titulo: undefined, corpo: undefined, ordem: undefined, ativo: false,
    });
  });

  it('500 quando o model lança erro', async () => {
    respostasRapidasModel.findById.mockResolvedValue({ id: 1, titulo: 'Saudação', corpo: 'Olá', ordem: 0, ativo: true });
    respostasRapidasModel.updateResposta.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .put('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ titulo: 'Novo título' });

    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/controle-ligacoes/respostas-rapidas/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/controle-ligacoes/respostas-rapidas/1');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .delete('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .delete('/api/controle-ligacoes/respostas-rapidas/abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('404 quando a resposta não existe', async () => {
    respostasRapidasModel.findById.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/controle-ligacoes/respostas-rapidas/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Resposta rápida não encontrada.' });
    expect(respostasRapidasModel.deleteResposta).not.toHaveBeenCalled();
  });

  it('204 — exclui com sucesso (exclusão física, sem checagem de vínculo)', async () => {
    respostasRapidasModel.findById.mockResolvedValue({ id: 1, titulo: 'Saudação', corpo: 'Olá', ordem: 0, ativo: true });
    respostasRapidasModel.deleteResposta.mockResolvedValue(true);

    const res = await request(app)
      .delete('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
    expect(respostasRapidasModel.deleteResposta).toHaveBeenCalledWith(1);
  });

  it('500 quando o model lança erro', async () => {
    respostasRapidasModel.findById.mockResolvedValue({ id: 1, titulo: 'Saudação', corpo: 'Olá', ordem: 0, ativo: true });
    respostasRapidasModel.deleteResposta.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .delete('/api/controle-ligacoes/respostas-rapidas/1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});
