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
      { id: 1, nome: 'Rede A', responsavel: 'Fulano', visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [] },
      { id: 2, nome: 'Rede B', responsavel: null, visivel: false, criado_em: '2024-01-02T00:00:00.000Z', lojas: [] },
    ]);

    const res = await request(app)
      .get('/api/ranking/redes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('visivel', true);
    expect(res.body[1]).toHaveProperty('visivel', false);
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
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: 'R', visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: 'R', visivel: false, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: false });

    expect(res.status).toBe(200);
    expect(res.body.visivel).toBe(false);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavel: undefined, visivel: false });
    // nome não foi enviado, então a checagem de duplicidade não deve rodar
    expect(rankingModel.existeRedeComNome).not.toHaveBeenCalled();
  });

  it('aceita visivel:true e repassa ao model', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: 'R', visivel: false });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: 'R', visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ visivel: true });

    expect(res.status).toBe(200);
    expect(res.body.visivel).toBe(true);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: undefined, responsavel: undefined, visivel: true });
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

  it('400 — corpo vazio (nenhum de nome/responsavel/visivel), mensagem atualizada', async () => {
    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Informe ao menos um campo ("nome", "responsavel" ou "visivel") para atualizar.',
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
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Rede X', responsavel: 'R', visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Rede X', responsavel: 'R', visivel: false, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor({ isAdmin: false })}`)
      .send({ visivel: false });

    // Comportamento atual: 200 (deveria ser 403 se a regra de negócio for
    // "restrito a admin" também no backend).
    expect(res.status).toBe(200);
  });

  // --- regressão: nome/responsavel continuam funcionando como antes ---
  it('regressão: continua aceitando atualizar somente "nome"', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Antigo', responsavel: 'R', visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(false);
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 5, nome: 'Novo Nome', responsavel: 'R', visivel: true, criado_em: '2024-01-01T00:00:00.000Z', lojas: [],
    });

    const res = await request(app)
      .put('/api/ranking/redes/5')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nome: 'Novo Nome' });

    expect(res.status).toBe(200);
    expect(res.body.nome).toBe('Novo Nome');
    expect(rankingModel.existeRedeComNome).toHaveBeenCalledWith('Novo Nome', 5);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(5, { nome: 'Novo Nome', responsavel: undefined, visivel: undefined });
  });

  it('regressão: 409 quando o novo nome já existe em outra rede', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 5, nome: 'Antigo', responsavel: 'R', visivel: true });
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
