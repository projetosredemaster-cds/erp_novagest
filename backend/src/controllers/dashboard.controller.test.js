const request = require('supertest');
const jwt = require('jsonwebtoken');
const dashboardService = require('../services/dashboard.service');
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
  for (const key of Object.keys(dashboardService)) {
    if (typeof dashboardService[key] === 'function') {
      vi.spyOn(dashboardService, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] dashboard.service.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('GET /api/controle-ligacoes/dashboard', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/dashboard');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);
    expect(res.status).toBe(403);
  });

  it('400 quando "estadoId" está em formato inválido (não chega a chamar o service)', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard?estadoId=abc')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('400 quando "estadoId" é zero ou negativo', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard?estadoId=0')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('400 quando "estadoId" não existe em Estados', async () => {
    dashboardService.existeEstado.mockResolvedValue(false);

    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard?estadoId=999')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Estado não encontrado.' });
    expect(dashboardService.getDashboard).not.toHaveBeenCalled();
  });

  it('200 — geral (sem estadoId) não chama existeEstado, repassa dataInicio/dataFim ao service', async () => {
    const dashboard = { totalDisparos: 20 };
    dashboardService.getDashboard.mockResolvedValue(dashboard);

    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard?dataInicio=2026-08-01&dataFim=2026-08-31')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(dashboard);
    expect(dashboardService.existeEstado).not.toHaveBeenCalled();
    expect(dashboardService.getDashboard).toHaveBeenCalledWith({
      estadoId: null,
      dataInicio: '2026-08-01',
      dataFim: '2026-08-31',
    });
  });

  it('200 — estadoId válido chama existeEstado antes de getDashboard', async () => {
    dashboardService.existeEstado.mockResolvedValue(true);
    dashboardService.getDashboard.mockResolvedValue({ totalDisparos: 0 });

    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard?estadoId=6')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(dashboardService.existeEstado).toHaveBeenCalledWith(6);
    expect(dashboardService.getDashboard).toHaveBeenCalledWith({ estadoId: 6, dataInicio: undefined, dataFim: undefined });
  });

  it('500 quando o service lança erro', async () => {
    dashboardService.getDashboard.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/dashboard')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/controle-ligacoes/aguardando-acao', () => {
  it('401 sem token', async () => {
    const res = await request(app).get('/api/controle-ligacoes/aguardando-acao');
    expect(res.status).toBe(401);
  });

  it('403 quando o usuário não é operador_cobranca', async () => {
    const res = await request(app)
      .get('/api/controle-ligacoes/aguardando-acao')
      .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`);
    expect(res.status).toBe(403);
  });

  it('200 — devolve a lista tal como o service devolve, sem aceitar estadoId/período', async () => {
    const itens = [{ contatoId: 1, tipo: 'sem_resposta' }];
    dashboardService.getAguardandoAcao.mockResolvedValue(itens);

    const res = await request(app)
      .get('/api/controle-ligacoes/aguardando-acao?estadoId=6&dataInicio=2026-08-01')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(itens);
    expect(dashboardService.getAguardandoAcao).toHaveBeenCalledWith();
  });

  it('200 — lista vazia quando ninguém está aguardando ação', async () => {
    dashboardService.getAguardandoAcao.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/controle-ligacoes/aguardando-acao')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('500 quando o service lança erro', async () => {
    dashboardService.getAguardandoAcao.mockRejectedValue(new Error('boom'));

    const res = await request(app)
      .get('/api/controle-ligacoes/aguardando-acao')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(res.status).toBe(500);
  });
});
