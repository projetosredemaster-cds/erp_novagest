
const request = require('supertest');
const jwt = require('jsonwebtoken');
const numerosRemetentesModel = require('../models/numerosRemetentes.model');
const baileysSessionService = require('../services/baileysSession.service');
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
  for (const key of Object.keys(numerosRemetentesModel)) {
    if (typeof numerosRemetentesModel[key] === 'function') {
      vi.spyOn(numerosRemetentesModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] numerosRemetentes.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL. Adicione um mockResolvedValue/mockRejectedValue no teste.'
        );
      });
    }
  }

  for (const key of Object.keys(baileysSessionService)) {
    if (typeof baileysSessionService[key] === 'function') {
      vi.spyOn(baileysSessionService, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] baileysSession.service.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado abrir/encerrar uma sessão Baileys de verdade. Adicione um mock explícito no teste.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/numeros-remetentes', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/numeros-remetentes');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor({ role: 'usuario' })}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Acesso restrito ao Controle de Ligações.' });
  });

  it('200 — lista números remetentes com o estado aninhado', async () => {
    numerosRemetentesModel.listNumeros.mockResolvedValue([
      {
        id: 3,
        apelido: 'CDC Cohatrac',
        numero: null,
        statusConexao: 'aguardando_conexao',
        ativo: true,
        criado_em: '2026-01-01T00:00:00.000Z',
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      },
    ]);

    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].estado).toEqual({ id: 6, nome: 'Maranhão', uf: 'MA' });
  });
});

describe('POST /api/controle-ligacoes/numeros-remetentes', () => {
  it('401 sem token', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes')
      .send({ apelido: 'CDC Cohatrac', estadoId: 6 });

    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
      .send({ apelido: 'CDC Cohatrac', estadoId: 6 });

    expect(res.status).toBe(403);
  });

  it('400 quando "apelido" está ausente', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 6 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "apelido" é obrigatório.' });
  });

  it('400 quando "estadoId" não existe', async () => {
    numerosRemetentesModel.existeEstado.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ apelido: 'CDC Cohatrac', estadoId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Estado informado não existe.' });
  });

  it('201 — cria o número remetente sempre com status_conexao aguardando_conexao', async () => {
    numerosRemetentesModel.existeEstado.mockResolvedValue(true);
    numerosRemetentesModel.insertNumero.mockResolvedValue({
      id: 3,
      apelido: 'CDC Cohatrac',
      numero: null,
      statusConexao: 'aguardando_conexao',
      ativo: true,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      criado_em: '2026-01-01T00:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ apelido: 'CDC Cohatrac', estadoId: 6 });

    expect(res.status).toBe(201);
    expect(res.body.statusConexao).toBe('aguardando_conexao');
    expect(res.body.numero).toBeNull();
    expect(numerosRemetentesModel.insertNumero).toHaveBeenCalledWith({ apelido: 'CDC Cohatrac', estadoId: 6 });
  });
});

describe('PUT /api/controle-ligacoes/numeros-remetentes/:id', () => {
  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/abc')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ apelido: 'Novo apelido' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });

  it('400 quando "ativo" é enviado com um tipo que não é boolean', async () => {
    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ativo: 'sim' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".' });
  });

  it('400 quando "estadoId" enviado não existe', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({ id: 3, apelido: 'CDC Cohatrac' });
    numerosRemetentesModel.existeEstado.mockResolvedValue(false);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ estadoId: 999 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Estado informado não existe.' });
  });

  it('404 quando o número não existe', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/999')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ apelido: 'Novo apelido' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Número remetente não encontrado.' });
  });

  it('200 — atualiza ativo:false com sucesso (soft toggle)', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', ativo: true })
      .mockResolvedValueOnce({
        id: 3,
        apelido: 'CDC Cohatrac',
        numero: null,
        statusConexao: 'aguardando_conexao',
        ativo: false,
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
        criado_em: '2026-01-01T00:00:00.000Z',
      });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ ativo: false });

    expect(res.status).toBe(200);
    expect(res.body.ativo).toBe(false);
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined,
      estadoId: undefined,
      ativo: false,
      nomeColaboradora: undefined,
    });
  });

  it('400 quando "nomeColaboradora" é enviado com um tipo inválido (número)', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({ id: 3, apelido: 'CDC Cohatrac' });

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nomeColaboradora: 123 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "nomeColaboradora", quando enviado, deve ser uma string ou null.',
    });
    expect(numerosRemetentesModel.updateNumero).not.toHaveBeenCalled();
  });

  it('400 quando "nomeColaboradora" é enviado com um tipo inválido (boolean)', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({ id: 3, apelido: 'CDC Cohatrac' });

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nomeColaboradora: true });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Campo "nomeColaboradora", quando enviado, deve ser uma string ou null.',
    });
    expect(numerosRemetentesModel.updateNumero).not.toHaveBeenCalled();
  });

  it('200 — nomeColaboradora ausente não altera o valor atual', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: 'Ana' })
      .mockResolvedValueOnce({ id: 3, apelido: 'Novo apelido', nomeColaboradora: 'Ana' });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ apelido: 'Novo apelido' });

    expect(res.status).toBe(200);
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: 'Novo apelido',
      estadoId: undefined,
      ativo: undefined,
      nomeColaboradora: undefined,
    });
  });

  it('200 — grava nomeColaboradora quando enviado como string válida (com trim)', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: null })
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: 'Ana Souza' });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nomeColaboradora: '  Ana Souza  ' });

    expect(res.status).toBe(200);
    expect(res.body.nomeColaboradora).toBe('Ana Souza');
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined,
      estadoId: undefined,
      ativo: undefined,
      nomeColaboradora: 'Ana Souza',
    });
  });

  it('200 — limpa nomeColaboradora (NULL) quando enviado como string vazia', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: 'Ana' })
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: null });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nomeColaboradora: '   ' });

    expect(res.status).toBe(200);
    expect(res.body.nomeColaboradora).toBeNull();
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined,
      estadoId: undefined,
      ativo: undefined,
      nomeColaboradora: null,
    });
  });

  it('200 — limpa nomeColaboradora (NULL) quando enviado explicitamente como null', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: 'Ana' })
      .mockResolvedValueOnce({ id: 3, apelido: 'CDC Cohatrac', nomeColaboradora: null });
    numerosRemetentesModel.updateNumero.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ nomeColaboradora: null });

    expect(res.status).toBe(200);
    expect(res.body.nomeColaboradora).toBeNull();
    expect(numerosRemetentesModel.updateNumero).toHaveBeenCalledWith(3, {
      apelido: undefined,
      estadoId: undefined,
      ativo: undefined,
      nomeColaboradora: null,
    });
  });
});

describe('DELETE /api/controle-ligacoes/numeros-remetentes/:id', () => {
  it('401 sem token', async () => {
    const res = await request(app).delete('/api/controle-ligacoes/numeros-remetentes/3');
    expect(res.status).toBe(401);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .delete('/api/controle-ligacoes/numeros-remetentes/abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  });


  it('409 quando existem contatos/importações vinculados', async () => {
    numerosRemetentesModel.deleteNumeroIfNoVinculos.mockResolvedValue('has_vinculos');

    const res = await request(app)
      .delete('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error:
        'Não é possível excluir este número pois existem contatos ou importações vinculadas a ele. Utilize a atualização (PUT) com ativo=false para desativá-lo.',
    });
  });

  it('404 quando o número não existe', async () => {
    numerosRemetentesModel.deleteNumeroIfNoVinculos.mockResolvedValue('not_found');

    const res = await request(app)
      .delete('/api/controle-ligacoes/numeros-remetentes/999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Número remetente não encontrado.' });
  });

  it('204 quando exclui com sucesso', async () => {
    numerosRemetentesModel.deleteNumeroIfNoVinculos.mockResolvedValue('deleted');

    const res = await request(app)
      .delete('/api/controle-ligacoes/numeros-remetentes/3')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(204);
  });
});

describe('GET /api/controle-ligacoes/numeros-remetentes/:id/conexao/stream', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/numeros-remetentes/3/conexao/stream');
    expect(res.status).toBe(401);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes/abc/conexao/stream')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
    expect(baileysSessionService.abrirConexao).not.toHaveBeenCalled();
  });

  it('404 quando o número remetente não existe', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue(undefined);

    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes/999/conexao/stream')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Número remetente não encontrado.' });
    expect(baileysSessionService.abrirConexao).not.toHaveBeenCalled();
  });

  it('"já conectado" — emite ja_conectado e encerra sem abrir sessão nova', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      apelido: 'CDC Cohatrac',
      numero: '5598912345678',
      statusConexao: 'conectado',
      ativo: true,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
    });

    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes/3/conexao/stream')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: ja_conectado');
    expect(res.text).toContain('"numero":"5598912345678"');
    expect(baileysSessionService.abrirConexao).not.toHaveBeenCalled();
  });

  it('não conectado — abre a sessão e retransmite qr/conectado do listener', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      apelido: 'CDC Cohatrac',
      numero: null,
      statusConexao: 'aguardando_conexao',
      ativo: true,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
    });

    baileysSessionService.abrirConexao.mockImplementation(async (numeroRemetenteId, listener) => {
      expect(numeroRemetenteId).toBe(3);
      listener.onQr('2@qrcru,dados==,fim');
      listener.onConectado('5598912345678');
    });
    baileysSessionService.removerListener.mockImplementation(() => {});

    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes/3/conexao/stream')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: qr');
    expect(res.text).toContain('2@qrcru,dados==,fim');
    expect(res.text).toContain('event: conectado');
    expect(res.text).toContain('"numero":"5598912345678"');
    expect(baileysSessionService.removerListener).toHaveBeenCalledWith(3, expect.any(Object));
  });

  it('propaga erro do listener como event: erro e encerra o stream', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue({
      id: 3,
      apelido: 'CDC Cohatrac',
      numero: null,
      statusConexao: 'aguardando_conexao',
      ativo: true,
      estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
    });

    baileysSessionService.abrirConexao.mockImplementation(async (numeroRemetenteId, listener) => {
      listener.onErro('Tempo esgotado aguardando leitura do QR Code. Tente novamente.');
    });
    baileysSessionService.removerListener.mockImplementation(() => {});

    const res = await request(app)
      .get('/api/controle-ligacoes/numeros-remetentes/3/conexao/stream')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: erro');
    expect(res.text).toContain('Tempo esgotado aguardando leitura do QR Code. Tente novamente.');
  });
});

describe('POST /api/controle-ligacoes/numeros-remetentes/:id/conexao/desconectar', () => {
  it('401 sem token', async () => {
    const res = await request(app).post('/api/controle-ligacoes/numeros-remetentes/3/conexao/desconectar');
    expect(res.status).toBe(401);
  });

  it('400 quando ":id" não é um inteiro positivo', async () => {
    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes/abc/conexao/desconectar')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
    expect(baileysSessionService.desconectar).not.toHaveBeenCalled();
  });

  it('404 quando o número remetente não existe', async () => {
    numerosRemetentesModel.findNumeroById.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes/999/conexao/desconectar')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Número remetente não encontrado.' });
    expect(baileysSessionService.desconectar).not.toHaveBeenCalled();
  });

  it('200 — encerra a sessão Baileys e grava numero=NULL/status_conexao=aguardando_conexao', async () => {
    numerosRemetentesModel.findNumeroById
      .mockResolvedValueOnce({
        id: 3,
        apelido: 'CDC Cohatrac',
        numero: '5598912345678',
        statusConexao: 'conectado',
        ativo: true,
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      })
      .mockResolvedValueOnce({
        id: 3,
        apelido: 'CDC Cohatrac',
        numero: null,
        statusConexao: 'aguardando_conexao',
        ativo: true,
        estado: { id: 6, nome: 'Maranhão', uf: 'MA' },
      });
    baileysSessionService.desconectar.mockResolvedValue(undefined);
    numerosRemetentesModel.updateConexao.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/controle-ligacoes/numeros-remetentes/3/conexao/desconectar')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body.numero).toBeNull();
    expect(res.body.statusConexao).toBe('aguardando_conexao');
    expect(baileysSessionService.desconectar).toHaveBeenCalledWith(3);
    expect(numerosRemetentesModel.updateConexao).toHaveBeenCalledWith(3, { numero: null, statusConexao: 'aguardando_conexao' });
  });
});
