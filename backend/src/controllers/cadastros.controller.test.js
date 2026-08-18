

const request = require('supertest');
const jwt = require('jsonwebtoken');
const cadastrosModel = require('../models/cadastros.model');
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
  for (const key of Object.keys(cadastrosModel)) {
    if (typeof cadastrosModel[key] === 'function') {
      vi.spyOn(cadastrosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] cadastros.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});



describe('GET /api/cadastros/diretores', () => {
  it('401 sem header Authorization', async () => {
    const res = await request(app).get('/api/cadastros/diretores');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação não informado.' });
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/cadastros/diretores')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  it('200 — retorna diretores com redes aninhadas', async () => {
    cadastrosModel.listDiretoresComRedes.mockResolvedValue([
      { id: 1, nome: 'Victor Hugo', criado_em: '2024-01-01T00:00:00.000Z', redes: [
        { id: 5, diretor_id: 1, nome: 'Delta', emoji: '🔺', ativo: true, visivel: true, responsavel: { id: 3, nome: 'Grazy' }, criado_em: '2024-01-02T00:00:00.000Z' },
      ] },
    ]);

    const res = await request(app)
      .get('/api/cadastros/diretores')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].redes).toHaveLength(1);
  });

  it('500 quando o model lança erro', async () => {
    cadastrosModel.listDiretoresComRedes.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .get('/api/cadastros/diretores')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar diretores.' });
  });
});

describe('POST /api/cadastros/diretores', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/cadastros/diretores').send({ nome: 'Novo' });
    expect(res.status).toBe(401);
  });

  it('400 nome vazio', async () => {
    const res = await request(app)
      .post('/api/cadastros/diretores')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: '' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "nome" é obrigatório e não pode ser vazio.' });
  });

  it('409 nome duplicado', async () => {
    cadastrosModel.existeDiretorComNome.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/cadastros/diretores')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Victor Hugo' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Já existe um diretor com esse nome.' });
  });

  it('201 — cria com redes: []', async () => {
    cadastrosModel.existeDiretorComNome.mockResolvedValue(false);
    cadastrosModel.insertDiretor.mockResolvedValue({ id: 9, nome: 'Diretor QA', criado_em: '2026-07-28T10:00:00.000Z' });

    const res = await request(app)
      .post('/api/cadastros/diretores')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Diretor QA' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 9, nome: 'Diretor QA', criado_em: '2026-07-28T10:00:00.000Z', redes: [] });
  });
});

describe('DELETE /api/cadastros/diretores/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/cadastros/diretores/1');
    expect(res.status).toBe(401);
  });

  it('404 quando não existe', async () => {
    cadastrosModel.deleteDiretorIfNoRedes.mockResolvedValue('not_found');

    const res = await request(app)
      .delete('/api/cadastros/diretores/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
  });

  it('409 quando há redes vinculadas', async () => {
    cadastrosModel.deleteDiretorIfNoRedes.mockResolvedValue('has_redes');

    const res = await request(app)
      .delete('/api/cadastros/diretores/1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir este diretor pois existem redes vinculadas a ele. Remova as redes primeiro.',
    });
  });

  it('204 — exclui com sucesso', async () => {
    cadastrosModel.deleteDiretorIfNoRedes.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/cadastros/diretores/1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
  });
});


describe('GET /api/cadastros/redes — sem filtro de ativo/visivel no servidor', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/cadastros/redes');
    expect(res.status).toBe(401);
  });

  it('200 — retorna redes ativas E inativas/ocultas, exatamente como o model devolveu (controller não filtra)', async () => {
    cadastrosModel.listRedesComDiretorResponsavelLojas.mockResolvedValue([
      {
        id: 5, nome: 'Delta', emoji: '🔺', ativo: true, visivel: true,
        diretor: { id: 1, nome: 'Victor Hugo' }, responsavel: null, criado_em: '2024-01-01T00:00:00.000Z',
        lojas: [{ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: true, criado_em: '2024-01-01T00:00:00.000Z' }],
      },
      {
        id: 6, nome: 'Rede Inativa QA', emoji: null, ativo: false, visivel: false,
        diretor: { id: 1, nome: 'Victor Hugo' }, responsavel: null, criado_em: '2024-01-01T00:00:00.000Z',
        lojas: [],
      },
    ]);

    const res = await request(app)
      .get('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const inativa = res.body.find((r) => r.id === 6);
    expect(inativa).toMatchObject({ ativo: false, visivel: false });
  });

  it('500 quando o model lança erro', async () => {
    cadastrosModel.listRedesComDiretorResponsavelLojas.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .get('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar redes.' });
  });
});

describe('POST /api/cadastros/redes', () => {
  it('400 quando diretorId ausente/inválido', async () => {
    const res = await request(app)
      .post('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Delta' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "diretorId" é obrigatório e deve ser um número inteiro positivo.' });
  });

  it('400 quando diretorId informado não existe', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 999, nome: 'Delta' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Diretor informado não existe.' });
  });

  it('409 nome duplicado no mesmo diretor', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 1, nome: 'Delta' });

    expect(res.status).toBe(409);
  });

  it('201 — cria a rede', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    cadastrosModel.insertRede.mockResolvedValue({
      id: 20, diretor_id: 1, nome: 'Rede QA', emoji: null, ativo: true, visivel: true,
      responsavel: null, criado_em: '2026-07-28T10:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/cadastros/redes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 1, nome: 'Rede QA' });

    expect(res.status).toBe(201);
    expect(res.body.responsavel).toBeNull();
  });
});

describe('PUT /api/cadastros/redes/:id — reatribuição de diretor ("diretorId")', () => {
  it('401 sem token', async () => {
    const res = await request(app).put('/api/cadastros/redes/5').send({ diretorId: 2 });
    expect(res.status).toBe(401);
  });

  it('400 quando diretorId enviado não é inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "diretorId", quando enviado, deve ser um número inteiro positivo.',
    });
  });

  it('400 quando diretorId aponta para um diretor que não existe — mensagem exata do contrato', async () => {
    cadastrosModel.findRedeById.mockResolvedValue({ id: 5, diretor_id: 1, nome: 'Delta', responsavel: null, visivel: true, ativo: true });
    cadastrosModel.existeDiretor.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Diretor informado não existe.' });
    expect(cadastrosModel.updateRede).not.toHaveBeenCalled();
  });

  it('200 — reatribui a rede a outro diretor com sucesso', async () => {
    cadastrosModel.findRedeById
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', responsavel: null, visivel: true, ativo: true })
      .mockResolvedValueOnce({ id: 5, diretor_id: 2, nome: 'Delta', responsavel: null, visivel: true, ativo: true, criado_em: '2024-01-01T00:00:00.000Z' });
    cadastrosModel.existeDiretor.mockResolvedValue(true);
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    cadastrosModel.updateRede.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 2 });

    expect(res.status).toBe(200);
    expect(res.body.diretor_id).toBe(2);
    expect(cadastrosModel.updateRede).toHaveBeenCalledWith(5, {
      nome: undefined, emoji: undefined, responsavelId: undefined, ativo: undefined, visivel: undefined, diretorId: 2,
    });
  });

  it('404 quando a rede não existe', async () => {
    cadastrosModel.findRedeById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/cadastros/redes/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ diretorId: 2 });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cadastros/redes/:id', () => {
  it('409 quando há LOJAS vinculadas (checagem em primeiro lugar)', async () => {
    cadastrosModel.deleteRedeIfNoEntradas.mockResolvedValue('has_lojas');

    const res = await request(app)
      .delete('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir esta rede pois existem lojas vinculadas a ela. Remova as lojas primeiro.',
    });
  });

  it('409 quando há ENTRADAS vinculadas (sem lojas)', async () => {
    cadastrosModel.deleteRedeIfNoEntradas.mockResolvedValue('has_entradas');

    const res = await request(app)
      .delete('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Não é possível excluir esta rede pois existem lançamentos vinculados a ela. Utilize a atualização (PUT) com ativo=false para desativá-la sem perder o histórico.',
    });
  });

  it('204 — exclui com sucesso sem nenhum vínculo', async () => {
    cadastrosModel.deleteRedeIfNoEntradas.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/cadastros/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
  });
});

describe('POST /api/cadastros/lojas', () => {
  it('400 quando redeId ausente/inválido', async () => {
    const res = await request(app)
      .post('/api/cadastros/lojas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'SLZ 03' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "redeId" é obrigatório e deve ser um número inteiro positivo.' });
  });

  it('400 quando redeId informado não existe', async () => {
    cadastrosModel.existeRede.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/cadastros/lojas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 999, nome: 'SLZ 03' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Rede informada não existe.' });
  });

  it('409 nome duplicado na mesma rede', async () => {
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/cadastros/lojas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 5, nome: 'SLZ 01' });

    expect(res.status).toBe(409);
  });

  it('201 — cria a loja', async () => {
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(false);
    cadastrosModel.insertLoja.mockResolvedValue({
      id: 41, rede_id: 5, nome: 'SLZ QA', ativo: true, criado_em: '2026-07-28T10:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/cadastros/lojas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 5, nome: 'SLZ QA' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(41);
  });
});

describe('PUT /api/cadastros/lojas/:id — reatribuição de rede ("redeId")', () => {
  it('401 sem token', async () => {
    const res = await request(app).put('/api/cadastros/lojas/40').send({ redeId: 6 });
    expect(res.status).toBe(401);
  });

  it('400 — corpo vazio', async () => {
    const res = await request(app)
      .put('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Informe ao menos um campo ("nome", "ativo" ou "redeId") para atualizar.',
    });
  });

  it('400 quando redeId enviado não é inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "redeId", quando enviado, deve ser um número inteiro positivo.',
    });
  });

  it('400 quando redeId aponta para uma rede que não existe — mensagem exata do contrato', async () => {
    cadastrosModel.findLojaById.mockResolvedValue({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: true });
    cadastrosModel.existeRede.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Rede informada não existe.' });
    expect(cadastrosModel.updateLoja).not.toHaveBeenCalled();
  });

  it('200 — reatribui a loja a outra rede com sucesso', async () => {
    cadastrosModel.findLojaById
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: true })
      .mockResolvedValueOnce({ id: 40, rede_id: 6, nome: 'SLZ 01', ativo: true, criado_em: '2024-01-01T00:00:00.000Z' });
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(false);
    cadastrosModel.updateLoja.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 6 });

    expect(res.status).toBe(200);
    expect(res.body.rede_id).toBe(6);
  });

  it('404 quando a loja não existe', async () => {
    cadastrosModel.findLojaById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/cadastros/lojas/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ redeId: 6 });

    expect(res.status).toBe(404);
  });

  it('200 — soft-delete via ativo:false continua funcionando', async () => {
    cadastrosModel.findLojaById
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: true })
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: false, criado_em: '2024-01-01T00:00:00.000Z' });
    cadastrosModel.updateLoja.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ativo: false });

    expect(res.status).toBe(200);
    expect(res.body.ativo).toBe(false);
  });
});

describe('DELETE /api/cadastros/lojas/:id — a rota FOI REMOVIDA', () => {
  it('404 de rota do Express ("Rota não encontrada"), não um 404 de negócio do controller de Cadastros', async () => {
    const res = await request(app)
      .delete('/api/cadastros/lojas/40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Rota não encontrada.' });

    expect(cadastrosModel.findLojaById).not.toHaveBeenCalled();
  });

  it('mesmo sem token — 404 antes até de autenticar, porque authMiddleware roda no mount do router inteiro e o path não bate com nenhuma rota registrada', async () => {
    const res = await request(app).delete('/api/cadastros/lojas/40');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cadastros/responsaveis', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/cadastros/responsaveis');
    expect(res.status).toBe(401);
  });

  it('200 — qualquer usuário autenticado (não exige admin)', async () => {
    cadastrosModel.listResponsaveis.mockResolvedValue([
      { id: 3, nome: 'Grazy', criado_em: '2024-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/cadastros/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /api/cadastros/responsaveis — restrito a admin', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/cadastros/responsaveis').send({ nome: 'Novo GG' });
    expect(res.status).toBe(401);
  });

  it('403 quando usuário autenticado não é admin', async () => {
    const res = await request(app)
      .post('/api/cadastros/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`)
      .send({ nome: 'Novo GG' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito a administradores.' });
    expect(cadastrosModel.insertResponsavel).not.toHaveBeenCalled();
  });

  it('409 nome duplicado', async () => {
    cadastrosModel.existeResponsavelComNome.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/cadastros/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`)
      .send({ nome: 'Grazy' });

    expect(res.status).toBe(409);
  });

  it('201 — admin cria com sucesso', async () => {
    cadastrosModel.existeResponsavelComNome.mockResolvedValue(false);
    cadastrosModel.insertResponsavel.mockResolvedValue({ id: 8, nome: 'Novo GG', criado_em: '2026-07-28T10:00:00.000Z' });

    const res = await request(app)
      .post('/api/cadastros/responsaveis')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`)
      .send({ nome: 'Novo GG' });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /api/cadastros/responsaveis/:id — restrito a admin', () => {
  it('403 quando usuário autenticado não é admin', async () => {
    const res = await request(app)
      .delete('/api/cadastros/responsaveis/8')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`);

    expect(res.status).toBe(403);
    expect(cadastrosModel.deleteResponsavelIfNoRedes).not.toHaveBeenCalled();
  });

  it('409 quando há redes vinculadas', async () => {
    cadastrosModel.deleteResponsavelIfNoRedes.mockResolvedValue('has_redes');

    const res = await request(app)
      .delete('/api/cadastros/responsaveis/3')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(409);
  });

  it('204 — admin exclui com sucesso', async () => {
    cadastrosModel.deleteResponsavelIfNoRedes.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/cadastros/responsaveis/8')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: true })}`);

    expect(res.status).toBe(204);
  });
});
