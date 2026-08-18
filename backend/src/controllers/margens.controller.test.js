

const request = require('supertest');
const jwt = require('jsonwebtoken');
const margensModel = require('../models/margens.model');
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
  for (const key of Object.keys(margensModel)) {
    if (typeof margensModel[key] === 'function') {
      vi.spyOn(margensModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] margens.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/margens/entradas', () => {
  it('401 sem header Authorization', async () => {
    const res = await request(app).get('/api/margens/entradas?data=2026-07-28');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação não informado.' });
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-28')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação inválido ou expirado.' });
  });

  it('400 quando "data" está ausente', async () => {
    const res = await request(app)
      .get('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando "data" está em formato inválido', async () => {
    const res = await request(app)
      .get('/api/margens/entradas?data=28-07-2026')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetro "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('200 — array vazio quando não há lançamento na data', async () => {
    margensModel.listEntradasPorData.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(margensModel.listEntradasPorData).toHaveBeenCalledWith('2026-07-28');
  });

  it('200 — retorna os campos certos, com lucro/percentualMargem calculados corretamente', async () => {
    margensModel.listEntradasPorData.mockResolvedValue([
      {
        id: 900, data_ref: '2026-07-27T00:00:00.000Z', loja_id: 40,
        faturamento: 335328.34, custoProduto: 168124.80, totalTar: 6000.00,
        atualizado_em: '2026-07-27T18:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-27')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const entrada = res.body[0];
    expect(entrada).toMatchObject({
      id: 900, loja_id: 40,
      faturamento: 335328.34, custoProduto: 168124.80, totalTar: 6000.00,
    });
    expect(entrada.lucro).toBeCloseTo(161203.54, 2);
    expect(entrada.percentualMargem).toBeCloseTo(48.07, 2);
  });

  it('200 — reflete "margemInformada" (gravada na coluna franquia) no corpo da resposta', async () => {
    margensModel.listEntradasPorData.mockResolvedValue([
      {
        id: 901, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 41,
        faturamento: 100000, custoProduto: 40000, totalTar: 5000,
        margemInformada: 44.20,
        atualizado_em: '2026-07-28T18:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].margemInformada).toBe(44.20);
  });

  it('200 — reflete "margemInformada: 0" (modo Total Tar, distinto do modo margem colada) no corpo da resposta', async () => {
    margensModel.listEntradasPorData.mockResolvedValue([
      {
        id: 902, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 42,
        faturamento: 100000, custoProduto: 40000, totalTar: 5000,
        margemInformada: 0,
        atualizado_em: '2026-07-28T18:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].margemInformada).toBe(0);
  });

  it('500 quando o model lança erro', async () => {
    margensModel.listEntradasPorData.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .get('/api/margens/entradas?data=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar entradas de margem.' });
  });
});

describe('POST /api/margens/entradas', () => {
  const payloadValido = {
    data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
  };

  it('401 sem token', async () => {
    const res = await request(app).post('/api/margens/entradas').send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', 'Bearer token-invalido')
      .send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('400 quando "data" está ausente', async () => {
    const { data, ...resto } = payloadValido;
    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando "data" está em formato inválido', async () => {
    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, data: '28/07/2026' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "data" é obrigatório e deve estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando "lojaId" está ausente', async () => {
    const { lojaId, ...resto } = payloadValido;
    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
    expect(margensModel.existeLoja).not.toHaveBeenCalled();
  });

  it('400 quando "lojaId" é inválido (não inteiro positivo)', async () => {
    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, lojaId: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
  });

  it('400 quando "lojaId" não existe em Lojas', async () => {
    margensModel.existeLoja.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, lojaId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
    expect(margensModel.existeLoja).toHaveBeenCalledWith(999999);
  });

  it('400 quando "faturamento" está ausente', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    const { faturamento, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamento" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "faturamento" é negativo', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamento: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamento" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "custoProduto" está ausente', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    const { custoProduto, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "custoProduto" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "custoProduto" é negativo', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, custoProduto: -50 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "custoProduto" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "totalTar" está ausente', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    const { totalTar, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "totalTar" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "totalTar" é negativo', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, totalTar: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "totalTar" é obrigatório e deve ser um número maior ou igual a zero.',
    });
  });

  it('400 quando "margemInformada" é informado mas não é um número (ex: "abc")', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "margemInformada", quando informado, deve ser um número.',
    });
    expect(margensModel.upsertEntrada).not.toHaveBeenCalled();
  });

  it('200 — "margemInformada" ausente do corpo continua funcionando como hoje (model recebe 0)', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: 0,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 0,
    });
  });

  it('200 — "margemInformada: 44.20" é repassado ao model', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: 44.20,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: 44.20 });

    expect(res.status).toBe(200);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 44.20,
    });
  });

  it('200 — "margemInformada: -12.5" (negativo, caso de prejuízo) não é rejeitado — sem limite inferior', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: -12.5,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: -12.5 });

    expect(res.status).toBe(200);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: -12.5,
    });
  });

  it('200 — "margemInformada: 0" explícito é aceito e repassado como 0 (valor legítimo, não confundir com "ausente")', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: 0,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: 0 });

    expect(res.status).toBe(200);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 0,
    });
  });

  it('400 quando "margemInformada" é um objeto (não numérico — Number({}) é NaN)', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: {} });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "margemInformada", quando informado, deve ser um número.',
    });
    expect(margensModel.upsertEntrada).not.toHaveBeenCalled();
  });

  it('400 quando "margemInformada" é um array com mais de um item (não numérico — Number([1,2]) é NaN)', async () => {
    margensModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: [1, 2] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "margemInformada", quando informado, deve ser um número.',
    });
    expect(margensModel.upsertEntrada).not.toHaveBeenCalled();
  });

  it('200 — "margemInformada: \'\'" (string vazia) é aceito e convertido para 0, não gera 400 (Number(\'\') é 0, não NaN)', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: 0,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: '' });

    expect(res.status).toBe(200);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 0,
    });
  });

  it('200 — cria a entrada (primeira vez), acao: INSERT', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      atualizado_em: '2026-07-28T18:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(res.body.acao).toBe('INSERT');
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 0,
    });
  });

  it('200 — atualiza a entrada existente (segunda vez, mesma data+lojaId), acao: UPDATE', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'UPDATE', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 8000,
      atualizado_em: '2026-07-28T19:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, totalTar: 8000 });

    expect(res.status).toBe(200);
    expect(res.body.acao).toBe('UPDATE');
    expect(res.body.totalTar).toBe(8000);
  });

  it('200 — atualiza a entrada existente (UPDATE) também repassa "margemInformada" corretamente ao model', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockResolvedValue({
      acao: 'UPDATE', id: 900, data_ref: '2026-07-28T00:00:00.000Z', loja_id: 40,
      faturamento: 100000, custoProduto: 40000, totalTar: 5000, margemInformada: 44.20,
      atualizado_em: '2026-07-28T19:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, margemInformada: 44.20 });

    expect(res.status).toBe(200);
    expect(res.body.acao).toBe('UPDATE');
    expect(res.body.margemInformada).toBe(44.20);
    expect(margensModel.upsertEntrada).toHaveBeenCalledWith({
      data: '2026-07-28', lojaId: 40, faturamento: 100000, custoProduto: 40000, totalTar: 5000,
      margemInformada: 44.20,
    });
  });

  it('500 quando o model lança erro ao salvar', async () => {
    margensModel.existeLoja.mockResolvedValue(true);
    margensModel.upsertEntrada.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao salvar entrada de margem.' });
  });

  it('500 quando o model lança erro ao validar existência da loja', async () => {
    margensModel.existeLoja.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .post('/api/margens/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao salvar entrada de margem.' });
  });
});

describe('GET /api/margens/relatorio', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28');
    expect(res.status).toBe(401);
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  it('400 quando "dataInicio" está ausente', async () => {
    const res = await request(app)
      .get('/api/margens/relatorio?dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "dataInicio" e "dataFim" são obrigatórios e devem estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando "dataFim" está ausente', async () => {
    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "dataInicio" e "dataFim" são obrigatórios e devem estar no formato YYYY-MM-DD.',
    });
  });

  it('400 quando as duas datas estão ausentes', async () => {
    const res = await request(app)
      .get('/api/margens/relatorio')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "dataInicio" e "dataFim" são obrigatórios e devem estar no formato YYYY-MM-DD.',
    });
  });

  it('200 — cálculo correto com valores montados à mão (faturamento=1000, custoProduto=400, totalTar=100 -> lucro=500, percentualMargem=50%)', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja Teste',
        rede_id: 5, rede_nome: 'Delta',
        responsavel_id: 3, responsavel_nome: 'Grazy',
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 1000, custoProduto: 400, totalTar: 100,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const bloco = res.body[0];
    expect(bloco.diretor).toEqual({ id: 1, nome: 'Victor Hugo' });
    expect(bloco.rede).toEqual({ id: 5, nome: 'Delta', responsavel: { id: 3, nome: 'Grazy' } });
    expect(bloco.lojas).toHaveLength(1);
    expect(bloco.lojas[0]).toMatchObject({
      id: 1, nome: 'Loja Teste',
      faturamento: 1000, custoProduto: 400, totalTar: 100,
      lucro: 500, percentualMargem: 50,
      cor: 'verde',
    });
  });

  it('200 — fronteira de cor: percentualMargem = 41 -> verde', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja 41', rede_id: 5, rede_nome: 'Delta',
        responsavel_id: null, responsavel_nome: null,
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 100, custoProduto: 59, totalTar: 0,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].lojas[0].percentualMargem).toBe(41);
    expect(res.body[0].lojas[0].cor).toBe('verde');
    expect(res.body[0].rede.responsavel).toBeNull();
  });

  it('200 — fronteira de cor: percentualMargem = 40 -> amarelo', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja 40', rede_id: 5, rede_nome: 'Delta',
        responsavel_id: null, responsavel_nome: null,
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 100, custoProduto: 60, totalTar: 0,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].lojas[0].percentualMargem).toBe(40);
    expect(res.body[0].lojas[0].cor).toBe('amarelo');
  });

  it('200 — fronteira de cor: percentualMargem = 39,99 -> vermelho', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja 39,99', rede_id: 5, rede_nome: 'Delta',
        responsavel_id: null, responsavel_nome: null,
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 10000, custoProduto: 6001, totalTar: 0,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].lojas[0].percentualMargem).toBeCloseTo(39.99, 2);
    expect(res.body[0].lojas[0].cor).toBe('vermelho');
  });

  it('200 — loja sem nenhum lançamento no período não aparece no resultado (mock simula ausência)', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja Com Lançamento', rede_id: 5, rede_nome: 'Delta',
        responsavel_id: null, responsavel_nome: null,
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 1000, custoProduto: 400, totalTar: 100,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    const todasAsLojas = res.body.flatMap(b => b.lojas.map(l => l.nome));
    expect(todasAsLojas).toEqual(['Loja Com Lançamento']);
    expect(todasAsLojas).not.toContain('Loja Sem Lançamento');
  });

  it('200 — array vazio quando nenhuma loja tem lançamento no período', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('200 — "margemInformada"/"franquia" não aparece na resposta do relatório nem afeta o cálculo (é só auditoria do lançamento diário, ver CONTRATO-MARGENS-API.md v5)', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockResolvedValue([
      {
        loja_id: 1, loja_nome: 'Loja Teste', rede_id: 5, rede_nome: 'Delta',
        responsavel_id: null, responsavel_nome: null,
        diretor_id: 1, diretor_nome: 'Victor Hugo',
        faturamento: 1000, custoProduto: 400, totalTar: 100,
        margemInformada: 999, franquia: 999,
      },
    ]);

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    const loja = res.body[0].lojas[0];
    expect(loja).not.toHaveProperty('margemInformada');
    expect(loja).not.toHaveProperty('franquia');
    expect(loja.lucro).toBe(500);
    expect(loja.percentualMargem).toBe(50);
    expect(loja.cor).toBe('verde');
  });

  it('500 quando o model lança erro', async () => {
    margensModel.getSomasPorLojaNoPeriodo.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .get('/api/margens/relatorio?dataInicio=2026-07-01&dataFim=2026-07-28')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao gerar relatório de margens.' });
  });
});
