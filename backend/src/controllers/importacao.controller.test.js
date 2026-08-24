
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

  it('201 — importa e NUNCA atribui numero_remetente_id (isso não acontece mais na importação)', async () => {
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
        erros: [],
      })
    );
  });

  it('201 — classifica corretamente duplicado (banco), duplicado (mesmo arquivo), sem estado e erro de linha, gravando LoteImportacaoErros', async () => {
    // telefone já existente em Contatos (de uma importação anterior)
    importacaoModel.listTelefonesExistentes.mockResolvedValue([
      { id: 77, telefone: '5598900000001' },
    ]);
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

    // nunca atribui numero_remetente_id na importação.
    const chamada = importacaoModel.criarLoteEContatos.mock.calls[0][0];
    const contatosEnviados = chamada.contatos;
    expect(contatosEnviados).toHaveLength(2); // 1 com estado + 1 sem estado
    for (const contato of contatosEnviados) {
      expect(contato).not.toHaveProperty('numeroRemetenteId');
      expect(contato).not.toHaveProperty('numero_remetente_id');
    }

    // 4 linhas rejeitadas: 2 duplicadas + 2 erro de formato.
    const erros = chamada.erros;
    expect(erros).toHaveLength(4);

    const duplicadoBanco = erros.find((e) => e.nomePlanilha === 'Ja Existe no Banco');
    expect(duplicadoBanco).toMatchObject({
      tipo: 'duplicado',
      contatoPlanilha: '5598900000001',
      motivo: 'Telefone já cadastrado.',
      contatoExistenteId: 77,
    });
    expect(duplicadoBanco.linha).toBe(2);

    const duplicadoArquivo = erros.find((e) => e.nomePlanilha === 'Repetido no Arquivo');
    expect(duplicadoArquivo).toMatchObject({
      tipo: 'duplicado',
      contatoPlanilha: '5598984761733',
      motivo: 'Telefone já cadastrado.',
      contatoExistenteId: null,
    });

    const nomeVazio = erros.find((e) => e.linha === 6);
    expect(nomeVazio).toMatchObject({
      tipo: 'erro',
      nomePlanilha: null,
      motivo: 'Nome não informado.',
    });

    const telefoneCurto = erros.find((e) => e.nomePlanilha === 'Telefone Curto Demais');
    expect(telefoneCurto).toMatchObject({
      tipo: 'erro',
      motivo: 'Telefone inválido ou incompleto.',
    });
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

describe('POST /api/controle-ligacoes/contatos/importar/:loteId/confirmar (descontinuada em v3)', () => {
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

  it('410 sempre, independente do corpo — rota descontinuada', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/12/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: 'Rota descontinuada. A escolha de número acontece no Painel de Disparo.',
    });
  });

  it('410 mesmo com :loteId inválido ou corpo vazio', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/contatos/importar/abc/confirmar')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({});

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: 'Rota descontinuada. A escolha de número acontece no Painel de Disparo.',
    });
  });
});

describe('GET /api/controle-ligacoes/contatos/importar/historico', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/contatos/importar/historico');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/historico')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('200 — lista todos os lotes, mais recentes primeiro', async () => {
    importacaoModel.listHistorico.mockResolvedValue([
      {
        loteImportacaoId: 12,
        nomeArquivo: 'clientes_agosto.xlsx',
        usuarioEmail: 'liv@teste.com',
        totalLinhas: 150,
        totalImportados: 148,
        totalSemEstado: 0,
        totalDuplicado: 2,
        totalErro: 0,
        criado_em: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/historico')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        loteImportacaoId: 12,
        nomeArquivo: 'clientes_agosto.xlsx',
        usuarioEmail: 'liv@teste.com',
        totalLinhas: 150,
        totalImportados: 148,
        totalSemEstado: 0,
        totalDuplicado: 2,
        totalErro: 0,
        criado_em: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('500 quando o model lança erro', async () => {
    importacaoModel.listHistorico.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/historico')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao listar histórico de importações.' });
  });
});

describe('GET /api/controle-ligacoes/contatos/importar/:loteId', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/contatos/importar/12');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/12')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
  });

  it('404 quando :loteId não é inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Importação não encontrada.' });
    expect(importacaoModel.getDetalheLote).not.toHaveBeenCalled();
  });

  it('404 quando o lote não existe', async () => {
    importacaoModel.getDetalheLote.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Importação não encontrada.' });
  });

  it('200 — devolve resumo + porEstado (sem filtro de número) + erros', async () => {
    importacaoModel.getDetalheLote.mockResolvedValue({
      loteImportacaoId: 12,
      nomeArquivo: 'clientes_agosto.xlsx',
      usuarioEmail: 'liv@teste.com',
      totalLinhas: 150,
      totalImportados: 148,
      totalSemEstado: 0,
      totalDuplicado: 2,
      totalErro: 0,
      criado_em: '2026-01-01T00:00:00.000Z',
      porEstado: [{ estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 148 }],
      erros: [
        {
          linha: 7,
          tipo: 'duplicado',
          nomePlanilha: 'João Silva',
          contatoPlanilha: '5598900000000',
          motivo: 'Telefone já cadastrado.',
          contatoExistenteId: 5,
        },
      ],
    });

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/12')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body.loteImportacaoId).toBe(12);
    expect(res.body.porEstado).toEqual([
      { estado: { id: 6, nome: 'Maranhão', uf: 'MA' }, totalContatos: 148 },
    ]);
    expect(res.body.erros).toHaveLength(1);
    expect(res.body.erros[0]).toMatchObject({
      linha: 7,
      tipo: 'duplicado',
      motivo: 'Telefone já cadastrado.',
    });
    expect(importacaoModel.getDetalheLote).toHaveBeenCalledWith(12);
  });

  it('500 quando o model lança erro', async () => {
    importacaoModel.getDetalheLote.mockRejectedValue(new Error('falha de conexão'));

    const res = await request(app)
      .get('/api/controle-ligacoes/contatos/importar/12')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Erro interno ao buscar detalhe da importação.' });
  });
});
