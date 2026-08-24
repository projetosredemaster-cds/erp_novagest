
const request = require('supertest');
const jwt = require('jsonwebtoken');
const disparosModel = require('../models/disparos.model');
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
  for (const key of Object.keys(disparosModel)) {
    if (typeof disparosModel[key] === 'function') {
      vi.spyOn(disparosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] disparos.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/painel-disparo', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/painel-disparo');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/painel-disparo')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito ao Controle de Ligações.' });
  });

  it('200 — lista o painel, incluindo estado sem número ativo e sem contato', async () => {
    disparosModel.listPainelDisparo.mockResolvedValue([
      {
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
        totalContatos: 148,
        numerosAtivos: [{ id: 3, apelido: 'CDC Cohatrac', statusConexao: 'aguardando_conexao' }],
      },
      {
        estado: { id: 1, nome: 'Rondônia', uf: 'RO' },
        totalContatos: 0,
        numerosAtivos: [],
      },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/painel-disparo')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1]).toEqual({
      estado: { id: 1, nome: 'Rondônia', uf: 'RO' },
      totalContatos: 0,
      numerosAtivos: [],
    });
  });

  it('500 quando o model lança erro', async () => {
    disparosModel.listPainelDisparo.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/painel-disparo')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar painel de disparo.' });
  });
});

describe('GET /api/controle-ligacoes/estados/:estadoId/contatos-disponiveis', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/estados/6/contatos-disponiveis');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/estados/6/contatos-disponiveis')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":estadoId" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/estados/abc/contatos-disponiveis')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "estadoId" deve ser um número inteiro positivo.' });
  });

  it('200 — lista contatos com a flag disparadoUltimos3Dias', async () => {
    disparosModel.listContatosDisponiveis.mockResolvedValue([
      { id: 10, nome: 'Maria', telefone: '5598900000000', disparadoUltimos3Dias: true },
      { id: 11, nome: 'João', telefone: '5598900000001', disparadoUltimos3Dias: false },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/estados/6/contatos-disponiveis?busca=Mar&ordem=recentes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 10, nome: 'Maria', telefone: '5598900000000', disparadoUltimos3Dias: true },
      { id: 11, nome: 'João', telefone: '5598900000001', disparadoUltimos3Dias: false },
    ]);
    expect(disparosModel.listContatosDisponiveis).toHaveBeenCalledWith(6, {
      busca: 'Mar',
      ordem: 'recentes',
    });
  });

  it('500 quando o model lança erro', async () => {
    disparosModel.listContatosDisponiveis.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/estados/6/contatos-disponiveis')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar contatos disponíveis.' });
  });
});

describe('POST /api/controle-ligacoes/disparos', () => {
  const payloadValido = { estadoId: 6, numeroRemetenteId: 3, contatoIds: [10, 11] };

  it('401 sem token', async () => {
    const res = await request(app).post('/api/controle-ligacoes/disparos').send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send(payloadValido);

    expect(res.status).toBe(403);
  });

  it('400 quando "contatoIds" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "contatoIds" é obrigatório.' });
  });

  it('400 quando "contatoIds" está vazio', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "contatoIds" é obrigatório.' });
  });

  it('400 quando "contatoIds" tem mais de 10 itens', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: Array.from({ length: 11 }, (_, i) => i + 1) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Máximo de 10 contatos por disparo.' });
  });

  it('400 quando "estadoId" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 'abc', numeroRemetenteId: 3, contatoIds: [10, 11] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });

  it('400 quando "numeroRemetenteId" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: -1, contatoIds: [10, 11] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });

  it('400 quando algum item de "contatoIds" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: [10, 'abc'] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Todos os contatos devem pertencer ao estado informado.' });
    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });

  it('ordem de validação: numeroRemetenteId inválido é reportado antes de contatoIds inválido, quando os dois estão errados', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 'abc', numeroRemetenteId: 'def', contatoIds: [10, 'xyz'] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
  });

  it('400 quando o model recusa o número remetente (inexistente/inativo/estado errado)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'numero_invalido' });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
  });

  it('400 quando o model recusa algum contato (fora do estado informado)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({ status: 'contatos_invalidos' });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Todos os contatos devem pertencer ao estado informado.' });
  });

  it('201 — cria o disparo e devolve só disparoId/totalContatos (sem avisos, ver POST /disparos/verificar)', async () => {
    disparosModel.criarDisparo.mockResolvedValue({
      status: 'criado',
      disparoId: 42,
      totalContatos: 2,
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor({ id: 7 })}`)
      .send(payloadValido);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      disparoId: 42,
      totalContatos: 2,
    });
    expect(disparosModel.criarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      usuarioId: 7,
      contatoIds: [10, 11],
    });
  });

  it('500 quando o model lança erro', async () => {
    disparosModel.criarDisparo.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao criar disparo.' });
  });
});

describe('POST /api/controle-ligacoes/disparos/verificar', () => {
  const payloadValido = { estadoId: 6, numeroRemetenteId: 3, contatoIds: [10, 11] };

  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send(payloadValido);

    expect(res.status).toBe(403);
  });

  it('400 quando "contatoIds" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "contatoIds" é obrigatório.' });
    expect(disparosModel.verificarDisparo).not.toHaveBeenCalled();
  });

  it('400 quando "contatoIds" está vazio', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "contatoIds" é obrigatório.' });
  });

  it('400 quando "contatoIds" tem mais de 10 itens', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: Array.from({ length: 11 }, (_, i) => i + 1) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Máximo de 10 contatos por disparo.' });
  });

  it('400 quando "estadoId"/"numeroRemetenteId" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 'abc', numeroRemetenteId: 3, contatoIds: [10, 11] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
    expect(disparosModel.verificarDisparo).not.toHaveBeenCalled();
  });

  it('400 quando algum item de "contatoIds" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6, numeroRemetenteId: 3, contatoIds: [10, 'abc'] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Todos os contatos devem pertencer ao estado informado.' });
    expect(disparosModel.verificarDisparo).not.toHaveBeenCalled();
  });

  it('400 quando o model recusa o número remetente (inexistente/inativo/estado errado)', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'numero_invalido' });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Número remetente inválido para o estado informado.' });
  });

  it('400 quando o model recusa algum contato (fora do estado informado)', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'contatos_invalidos' });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Todos os contatos devem pertencer ao estado informado.' });
  });

  it('200 — devolve avisos não-vazios sem gravar nada (não chama criarDisparo)', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({
      status: 'ok',
      avisos: [{ contatoId: 10, nome: 'Maria', telefone: '5598900000000' }],
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      avisos: [{ contatoId: 10, nome: 'Maria', telefone: '5598900000000' }],
    });
    expect(disparosModel.verificarDisparo).toHaveBeenCalledWith({
      estadoId: 6,
      numeroRemetenteId: 3,
      contatoIds: [10, 11],
    });
    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });

  it('200 — avisos vazio quando nenhum contato foi disparado nos últimos 3 dias', async () => {
    disparosModel.verificarDisparo.mockResolvedValue({ status: 'ok', avisos: [] });

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ avisos: [] });
  });

  it('nunca grava nada no banco (contagem de Disparos não muda ao chamar verificar)', async () => {
    let totalDisparosGravados = 0;
    // Simula o mock do model: verificarDisparo nunca incrementa o contador;
    // só criarDisparo (não chamado neste teste) incrementaria.
    disparosModel.verificarDisparo.mockImplementation(async () => ({
      status: 'ok',
      avisos: [],
    }));
    disparosModel.criarDisparo.mockImplementation(async () => {
      totalDisparosGravados += 1;
      return { status: 'criado', disparoId: 1, totalContatos: 2 };
    });

    const contagemAntes = totalDisparosGravados;

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(totalDisparosGravados).toBe(contagemAntes);
    expect(disparosModel.criarDisparo).not.toHaveBeenCalled();
  });

  it('500 quando o model lança erro', async () => {
    disparosModel.verificarDisparo.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .post('/api/controle-ligacoes/disparos/verificar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao verificar disparo.' });
  });
});

describe('GET /api/controle-ligacoes/disparos/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/disparos/15');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/disparos/15')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);

    expect(res.status).toBe(403);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/disparos/abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
    expect(disparosModel.findDisparoDetalhe).not.toHaveBeenCalled();
  });

  it('404 quando o disparo não existe', async () => {
    disparosModel.findDisparoDetalhe.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/controle-ligacoes/disparos/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Disparo não encontrado.' });
  });

  it('200 — devolve o detalhe completo do disparo', async () => {
    disparosModel.findDisparoDetalhe.mockResolvedValue({
      disparoId: 15,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      numeroRemetente: { id: 3, apelido: 'CDC Cohatrac' },
      contatos: [
        {
          nome: 'Maria Silva',
          telefone: '5598900000000',
          status: 'enviado',
          mensagemEnviada: 'Olá Maria!',
          enviadoEm: '2026-08-24T12:00:00.000Z',
          erro: null,
        },
      ],
    });

    const res = await request(app)
      .get('/api/controle-ligacoes/disparos/15')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      disparoId: 15,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      numeroRemetente: { id: 3, apelido: 'CDC Cohatrac' },
      contatos: [
        {
          nome: 'Maria Silva',
          telefone: '5598900000000',
          status: 'enviado',
          mensagemEnviada: 'Olá Maria!',
          enviadoEm: '2026-08-24T12:00:00.000Z',
          erro: null,
        },
      ],
    });
    expect(disparosModel.findDisparoDetalhe).toHaveBeenCalledWith(15);
  });

  it('500 quando o model lança erro', async () => {
    disparosModel.findDisparoDetalhe.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/disparos/15')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao buscar detalhe do disparo.' });
  });
});
