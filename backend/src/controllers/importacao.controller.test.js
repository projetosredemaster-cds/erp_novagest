
const request = require('supertest');
const jwt = require('jsonwebtoken');
const importacaoModel = require('../models/importacao.model');
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
  for (const key of Object.keys(importacaoModel)) {
    if (typeof importacaoModel[key] === 'function') {
      vi.spyOn(importacaoModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] importacao.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }
});

describe('POST /api/controle-ligacoes/contatos/importar', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .attach('arquivo', Buffer.from('NOME,CONTATO\n'), 'clientes.csv');

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`)
      .attach('arquivo', Buffer.from('NOME,CONTATO\n'), 'clientes.csv');

    expect(res.status).toBe(403);
  });

  it('400 quando nenhum arquivo é enviado', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Arquivo é obrigatório.' });
  });

  it('400 quando a extensão não é .xlsx nem .csv', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .attach('arquivo', Buffer.from('conteudo qualquer'), 'clientes.txt');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Formato de arquivo não suportado. Envie .xlsx ou .csv.',
    });
  });

  it('201 — importa e NUNCA atribui numero_remetente_id (só a confirmação faz isso)', async () => {
    importacaoModel.listTelefonesExistentes.mockResolvedValue([]);
    importacaoModel.listEstadoDDDs.mockResolvedValue([
      { ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' },
    ]);
    importacaoModel.criarLoteEContatos.mockResolvedValue({
      loteImportacaoId: 12,
      criado_em: '2026-01-01T00:00:00.000Z',
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 1 }],
    });

    const csv = 'NOME,CONTATO\nFulano de Tal,5598984761733\n';

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .attach('arquivo', Buffer.from(csv), 'clientes.csv');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      loteImportacaoId: 12,
      totalLinhas: 1,
      totalImportados: 1,
      totalSemEstado: 0,
      totalDuplicado: 0,
      totalErro: 0,
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 1 }],
      criado_em: '2026-01-01T00:00:00.000Z',
    });

    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({
        contatos: [
          expect.objectContaining({
            nome: 'Fulano de Tal',
            telefone: '5598984761733',
            ddd: '98',
            estadoId: 6,
          }),
        ],
      })
    );
  });

  it('201 — classifica corretamente duplicado (banco), duplicado (mesmo arquivo), sem estado e erro de linha', async () => {
    // telefone já existente em Contatos (de uma importação anterior)
    importacaoModel.listTelefonesExistentes.mockResolvedValue(['5598900000001']);
    importacaoModel.listEstadoDDDs.mockResolvedValue([
      { ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' },
    ]);
    importacaoModel.criarLoteEContatos.mockResolvedValue({
      loteImportacaoId: 20,
      criado_em: '2026-01-01T00:00:00.000Z',
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 1 }],
    });

    const csv = [
      'NOME,CONTATO',
      'Ja Existe no Banco,5598900000001', // total_duplicado (já em Contatos)
      'Contato Valido,5598984761733', // válido, com estado
      'Repetido no Arquivo,5598984761733', // total_duplicado (repetido no mesmo lote)
      'Sem DDD Cadastrado,5511988887777', // total_sem_estado (DDD 11 não cadastrado)
      ',5598911112222', // total_erro (nome vazio)
      'Telefone Curto Demais,5598911', // total_erro (telefone sem DDD extraível)
    ].join('\n') + '\n';

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .attach('arquivo', Buffer.from(csv), 'clientes.csv');

    expect(res.status).toBe(201);
    expect(res.body.totalLinhas).toBe(6);
    expect(res.body.totalDuplicado).toBe(2);
    expect(res.body.totalSemEstado).toBe(1);
    expect(res.body.totalErro).toBe(2);
    expect(res.body.totalImportados).toBe(1);

    // nunca atribui numero_remetente_id na importação — só a confirmação faz isso.
    const contatosEnviados = importacaoModel.criarLoteEContatos.mock.calls[0][0].contatos;
    expect(contatosEnviados).toHaveLength(2); // 1 com estado + 1 sem estado
    for (const contato of contatosEnviados) {
      expect(contato).not.toHaveProperty('numeroRemetenteId');
      expect(contato).not.toHaveProperty('numero_remetente_id');
    }
  });

  it('400 quando as colunas NOME/CONTATO estão ausentes', async () => {
    const csv = 'NAME,PHONE\nFulano,5598984761733\n';

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .attach('arquivo', Buffer.from(csv), 'clientes.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'A planilha deve conter as colunas "NOME" e "CONTATO".',
    });
    expect(importacaoModel.criarLoteEContatos).not.toHaveBeenCalled();
  });
});

describe('POST /api/controle-ligacoes/contatos/importar/:loteId/confirmar', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(403);
  });

  it('400 quando um item de "escolhas" é malformado (não numérico) — reaproveita a mensagem de campo obrigatório', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 'abc', numeroRemetenteId: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "escolhas" é obrigatório.' });
    expect(importacaoModel.confirmarLote).not.toHaveBeenCalled();
  });

  it('400 quando :loteId não é inteiro positivo', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/abc/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Lote de importação não encontrado.' });
  });

  it('400 quando "escolhas" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "escolhas" é obrigatório.' });
  });

  it('400 quando o lote já foi confirmado', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({ status: 'ja_confirmado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Este lote já foi confirmado anteriormente.' });
  });

  it('400 — número remetente inválido para o estado, mensagem exata', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({
      status: 'numero_invalido',
      estadoNome: 'Maranhão',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 999 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Número remetente informado é inválido para o estado "Maranhão".',
    });
  });

  it('400 quando falta escolha para algum estado do lote', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({ status: 'faltando_escolha' });

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'É necessário escolher um número para todos os estados deste lote.',
    });
  });

  it('200 — confirma a distribuição com sucesso', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({ status: 'confirmado' });

    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ loteImportacaoId: 12, confirmado: true });
  });
});

describe('GET /api/controle-ligacoes/contatos/importar/pendentes', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/contatos/importar/pendentes');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/pendentes')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('200 — lista lotes pendentes', async () => {
    importacaoModel.listLotesPendentes.mockResolvedValue([
      { loteImportacaoId: 12, nomeArquivo: 'clientes_agosto.xlsx', totalImportados: 148, criado_em: '2026-01-01T00:00:00.000Z' },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/pendentes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { loteImportacaoId: 12, nomeArquivo: 'clientes_agosto.xlsx', totalImportados: 148, criado_em: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
