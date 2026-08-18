// Testes de integração de rota (Supertest, sem subir o servidor de verdade,
// sem tocar o Azure SQL real) para o módulo Marketing (ver
// CONTRATO-MARKETING-API.md v1). Cobre:
//   - GET    /api/marketing/entradas
//   - POST   /api/marketing/entradas (upsert)
//   - DELETE /api/marketing/entradas (idempotente)
//   - autenticação (401 sem token / token inválido)
//
// NOTA DE IMPLEMENTAÇÃO — por que `require()` (CJS puro) em vez de `import`:
// mesmo motivo documentado no topo de `ranking.controller.test.js`/
// `margens.controller.test.js`: `vi.mock('../models/X', factory)` com
// sintaxe `import` só intercepta o require feito DENTRO do próprio arquivo
// de teste; como `marketing.service.js`/`marketing.controller.js`/`app.js`
// são CommonJS puro (sem `import`/`export`), o require interno deles não
// passa pelo grafo de módulos do Vite e continuaria resolvendo para o model
// REAL. A alternativa segura usada aqui é obter a MESMA referência de
// objeto que `marketing.service.js` usa (garantida pelo cache de módulos do
// Node, compartilhado entre requires em CJS puro) e sobrescrever cada
// método com `vi.spyOn(...).mockImplementation(...)`.
//
// Rede de segurança: todo método do model recebe, por padrão, uma
// implementação-guarda que lança erro se for chamada sem um mock explícito
// no teste — qualquer teste que acidentalmente dependa de um método não
// mockado falha ALTO E CLARO em vez de silenciosamente tentar uma conexão
// real com o Azure SQL de produção.

const request = require('supertest');
const jwt = require('jsonwebtoken');
const marketingModel = require('../models/marketing.model');
const app = require('../app');

function tokenFor({ isAdmin = false } = {}) {
  return jwt.sign(
    { id: 1, email: 'user@teste.com', isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// linha "crua" como o model devolveria (JOIN Lojas->Redes->Diretores, LEFT
// JOIN duplo em MarketingEntradas) — ver marketing.model.js.
function rowLoja({
  diretorId = 1, diretorNome = 'Victor Hugo',
  redeId = 5, redeNome = 'Delta',
  lojaId = 40, lojaNome = 'SLZ 01',
  faturamentoGeral = null, faturamentoMarketing = null, faturamentoRetornoIndicacao = null,
  atualizadoEm = null,
  faturamentoGeralAnterior = null, faturamentoMarketingAnterior = null, faturamentoRetornoIndicacaoAnterior = null,
} = {}) {
  return {
    diretor_id: diretorId, diretor_nome: diretorNome,
    rede_id: redeId, rede_nome: redeNome,
    loja_id: lojaId, loja_nome: lojaNome,
    faturamentoGeral, faturamentoMarketing, faturamentoRetornoIndicacao,
    atualizadoEm,
    faturamentoGeralAnterior, faturamentoMarketingAnterior, faturamentoRetornoIndicacaoAnterior,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  // guarda: qualquer método do model chamado sem mock explícito no teste
  // lança, em vez de tentar se conectar ao Azure SQL real.
  for (const key of Object.keys(marketingModel)) {
    if (typeof marketingModel[key] === 'function') {
      vi.spyOn(marketingModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] marketing.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('GET /api/marketing/entradas', () => {
  it('401 sem header Authorization', async () => {
    const res = await request(app).get('/api/marketing/entradas?ano=2026&mes=8');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação não informado.' });
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token de autenticação inválido ou expirado.' });
  });

  it('400 quando "ano" está ausente', async () => {
    const res = await request(app)
      .get('/api/marketing/entradas?mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "mes" está ausente', async () => {
    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "mes" está fora do intervalo 1-12', async () => {
    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=13')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "ano"/"mes" não são numéricos', async () => {
    const res = await request(app)
      .get('/api/marketing/entradas?ano=abc&mes=xx')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('200 — array vazio quando não há loja nenhuma', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(marketingModel.listLojasAtivasComEntradas).toHaveBeenCalledWith({
      dataRef: '2026-08-01', dataRefAnterior: '2026-07-01',
    });
  });

  it('200 — loja SEM lançamento no mês vem com todos os campos de valor/percentual/comparação como null', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ lojaId: 41, lojaNome: 'SLZ 02' }),
    ]);

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    const loja = res.body[0].lojas[0];
    expect(loja).toMatchObject({
      id: 41, nome: 'SLZ 02',
      faturamentoGeral: null, faturamentoMarketing: null, faturamentoRetornoIndicacao: null,
      percentualMarketing: null, percentualRetornoIndicacao: null,
      comparacao: null, atualizadoEm: null,
    });
  });

  it('200 — retorna a resposta agrupada Diretor/Rede/Loja, com percentuais e comparação calculados corretamente', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({
        lojaId: 40, lojaNome: 'SLZ 01',
        faturamentoGeral: 261451.99, faturamentoMarketing: 104294.00, faturamentoRetornoIndicacao: 31200.00,
        atualizadoEm: '2026-08-05T14:00:00.000Z',
        faturamentoGeralAnterior: 200000, faturamentoMarketingAnterior: 90000, faturamentoRetornoIndicacaoAnterior: 40000,
      }),
    ]);

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0].diretor).toEqual({ id: 1, nome: 'Victor Hugo' });
    expect(res.body[0].rede).toEqual({ id: 5, nome: 'Delta' });
    const loja = res.body[0].lojas[0];
    expect(loja.id).toBe(40);
    expect(loja.faturamentoGeral).toBe(261451.99);
    expect(loja.percentualMarketing).toBeCloseTo(39.89, 2);
    expect(loja.percentualRetornoIndicacao).toBeCloseTo(11.93, 2);
    expect(loja.comparacao).toEqual({
      faturamentoGeral: 'subiu', faturamentoMarketing: 'subiu', faturamentoRetornoIndicacao: 'caiu',
    });
    expect(loja.atualizadoEm).toBe('2026-08-05T14:00:00.000Z');
  });

  it('200 — a filtragem de Rede/Loja inativa é responsabilidade do SQL do model (WHERE l.ativo=1 AND r.ativo=1); o controller/service só repassa o que o model devolve — se o mock só devolve lojas ativas, só elas aparecem na resposta', async () => {
    // Este teste documenta o contrato, não valida o SQL real (que exigiria banco de teste
    // provisionado — ver relatório de QA): com o model mockado para simular o efeito do WHERE
    // ativo=1 (só devolvendo a loja ativa), a resposta reflete fielmente isso.
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ lojaId: 40, lojaNome: 'Loja Ativa' }),
    ]);

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    const nomes = res.body.flatMap(b => b.lojas.map(l => l.nome));
    expect(nomes).toEqual(['Loja Ativa']);
  });

  it('200 — a resposta NÃO tem campo "totais" por Diretor nem agrupamento redes[] aninhado (formato real diverge do exemplo em CONTRATO-MARKETING-API.md, ver relatório de QA)', async () => {
    marketingModel.listLojasAtivasComEntradas.mockResolvedValue([
      rowLoja({ lojaId: 40 }),
    ]);

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body[0]).not.toHaveProperty('totais');
    expect(res.body[0]).not.toHaveProperty('redes');
    expect(res.body[0]).toHaveProperty('diretor');
    expect(res.body[0]).toHaveProperty('rede');
    expect(res.body[0]).toHaveProperty('lojas');
  });

  it('500 quando o model lança erro', async () => {
    marketingModel.listLojasAtivasComEntradas.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .get('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar entradas de marketing.' });
  });
});

describe('POST /api/marketing/entradas', () => {
  const payloadValido = {
    lojaId: 40, ano: 2026, mes: 8,
    faturamentoGeral: 261451.99, faturamentoMarketing: 104294.00, faturamentoRetornoIndicacao: 31200.00,
  };

  it('401 sem token', async () => {
    const res = await request(app).post('/api/marketing/entradas').send(payloadValido);
    expect(res.status).toBe(401);
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', 'Bearer token-invalido')
      .send(payloadValido);
    expect(res.status).toBe(401);
  });

  // ---- Ordem exata de validação (CONTRATO-MARKETING-API.md, seção 2):
  // lojaId -> ano/mes -> faturamentoGeral -> faturamentoMarketing -> faturamentoRetornoIndicacao

  it('400 quando "lojaId" está ausente — 1º na ordem de validação', async () => {
    const { lojaId, ...resto } = payloadValido;
    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
    // não deveria nem consultar o model — lojaId já falha em formato antes disso
    expect(marketingModel.existeLoja).not.toHaveBeenCalled();
  });

  it('400 quando "lojaId" é inválido (não inteiro positivo)', async () => {
    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, lojaId: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
  });

  it('400 quando "lojaId" não existe em Lojas', async () => {
    marketingModel.existeLoja.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, lojaId: 999999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Loja informada não existe.' });
    expect(marketingModel.existeLoja).toHaveBeenCalledWith(999999);
  });

  it('400 quando "ano"/"mes" estão ausentes — 2º na ordem de validação (depois de lojaId válido)', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    const { ano, mes, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campos "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
    expect(marketingModel.upsertEntrada).not.toHaveBeenCalled();
  });

  it('400 quando "mes" é inválido (fora de 1-12)', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, mes: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campos "ano" e "mes" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "faturamentoGeral" está ausente — 3º na ordem de validação', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    const { faturamentoGeral, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoGeral" é obrigatório e deve ser maior ou igual a zero.',
    });
  });

  it('400 quando "faturamentoGeral" é negativo', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamentoGeral: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoGeral" é obrigatório e deve ser maior ou igual a zero.',
    });
  });

  it('400 quando "faturamentoMarketing" está ausente — 4º na ordem de validação', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    const { faturamentoMarketing, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoMarketing" é obrigatório e deve ser maior ou igual a zero.',
    });
  });

  it('400 quando "faturamentoMarketing" é negativo', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamentoMarketing: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoMarketing" é obrigatório e deve ser maior ou igual a zero.',
    });
  });

  it('400 quando "faturamentoRetornoIndicacao" está ausente — 5º e último na ordem de validação', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    const { faturamentoRetornoIndicacao, ...resto } = payloadValido;

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(resto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoRetornoIndicacao" é obrigatório e deve ser maior ou igual a zero.',
    });
    expect(marketingModel.upsertEntrada).not.toHaveBeenCalled();
  });

  it('400 quando "faturamentoRetornoIndicacao" é negativo', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamentoRetornoIndicacao: -1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "faturamentoRetornoIndicacao" é obrigatório e deve ser maior ou igual a zero.',
    });
  });

  it('200 — cria a entrada (primeira vez), acao: INSERT, resposta em camelCase', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    marketingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 900, lojaId: 40, dataRef: '2026-08-01T00:00:00.000Z',
      faturamentoGeral: 261451.99, faturamentoMarketing: 104294.00, faturamentoRetornoIndicacao: 31200.00,
      atualizadoEm: '2026-08-05T14:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      acao: 'INSERT', id: 900, lojaId: 40, dataRef: '2026-08-01T00:00:00.000Z',
      faturamentoGeral: 261451.99, faturamentoMarketing: 104294.00, faturamentoRetornoIndicacao: 31200.00,
      atualizadoEm: '2026-08-05T14:00:00.000Z',
    });
    expect(marketingModel.upsertEntrada).toHaveBeenCalledWith({
      dataRef: '2026-08-01', lojaId: 40,
      faturamentoGeral: 261451.99, faturamentoMarketing: 104294.00, faturamentoRetornoIndicacao: 31200.00,
    });
  });

  it('200 — atualiza a entrada existente (segunda vez, mesmo ano+mes+lojaId), acao: UPDATE (upsert)', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    marketingModel.upsertEntrada.mockResolvedValue({
      acao: 'UPDATE', id: 900, lojaId: 40, dataRef: '2026-08-01T00:00:00.000Z',
      faturamentoGeral: 300000, faturamentoMarketing: 120000, faturamentoRetornoIndicacao: 35000,
      atualizadoEm: '2026-08-06T09:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamentoGeral: 300000, faturamentoMarketing: 120000, faturamentoRetornoIndicacao: 35000 });

    expect(res.status).toBe(200);
    expect(res.body.acao).toBe('UPDATE');
    expect(res.body.faturamentoGeral).toBe(300000);
  });

  it('200 — aceita faturamento = 0 nos 3 campos (zero é valor legítimo, não é "ausente")', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    marketingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 901, lojaId: 40, dataRef: '2026-08-01T00:00:00.000Z',
      faturamentoGeral: 0, faturamentoMarketing: 0, faturamentoRetornoIndicacao: 0,
      atualizadoEm: '2026-08-05T14:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ...payloadValido, faturamentoGeral: 0, faturamentoMarketing: 0, faturamentoRetornoIndicacao: 0 });

    expect(res.status).toBe(200);
    expect(marketingModel.upsertEntrada).toHaveBeenCalledWith({
      dataRef: '2026-08-01', lojaId: 40,
      faturamentoGeral: 0, faturamentoMarketing: 0, faturamentoRetornoIndicacao: 0,
    });
  });

  it('500 quando o model lança erro ao salvar', async () => {
    marketingModel.existeLoja.mockResolvedValue(true);
    marketingModel.upsertEntrada.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao salvar entrada de marketing.' });
  });

  it('500 quando o model lança erro ao validar existência da loja', async () => {
    marketingModel.existeLoja.mockRejectedValue(new Error('falha de conexão simulada'));

    const res = await request(app)
      .post('/api/marketing/entradas')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send(payloadValido);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao salvar entrada de marketing.' });
  });
});

describe('DELETE /api/marketing/entradas', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40');
    expect(res.status).toBe(401);
  });

  it('401 com token inválido', async () => {
    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });

  it('400 quando "ano" está ausente', async () => {
    const res = await request(app)
      .delete('/api/marketing/entradas?mes=8&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano", "mes" e "lojaId" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "mes" está ausente', async () => {
    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano", "mes" e "lojaId" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "lojaId" está ausente', async () => {
    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano", "mes" e "lojaId" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('400 quando "lojaId" não é inteiro positivo', async () => {
    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=-1')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Parâmetros "ano", "mes" e "lojaId" são obrigatórios e devem ser numéricos válidos (mes entre 1 e 12).',
    });
  });

  it('204 — remove a entrada existente', async () => {
    marketingModel.deleteEntrada.mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
    expect(marketingModel.deleteEntrada).toHaveBeenCalledWith({ dataRef: '2026-08-01', lojaId: 40 });
  });

  it('204 — idempotente: chamar duas vezes seguidas, a segunda ainda devolve 204 (mesmo sem linha pra apagar)', async () => {
    marketingModel.deleteEntrada.mockResolvedValue(undefined);

    const primeira = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);
    const segunda = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(primeira.status).toBe(204);
    expect(segunda.status).toBe(204);
    expect(marketingModel.deleteEntrada).toHaveBeenCalledTimes(2);
  });

  it('500 quando o model lança erro', async () => {
    marketingModel.deleteEntrada.mockRejectedValue(new Error('falha simulada'));

    const res = await request(app)
      .delete('/api/marketing/entradas?ano=2026&mes=8&lojaId=40')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao excluir entrada de marketing.' });
  });
});
