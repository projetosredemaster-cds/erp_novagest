// Teste unitário de `ranking.service.atualizarRede`, isolado do Express e do
// banco real — `ranking.model` é substituído por spies (`vi.spyOn`) que
// sobrescrevem os métodos no MESMO objeto que `ranking.service.js` usa
// internamente (garantido pelo cache de módulos do Node, compartilhado
// entre requires CJS) — ver nota detalhada em
// `../controllers/ranking.redes.visivel.test.js` sobre por que `vi.mock()`
// não é confiável aqui (chegou a golpear o Azure SQL real em um teste
// exploratório). Cobre as três ramificações de retorno (`null` /
// `'nome_duplicado'` / objeto atualizado) e confirma que `visivel` é
// repassado ao model como qualquer outro campo parcial.

const rankingModel = require('../models/ranking.model');
const rankingService = require('./ranking.service');

beforeEach(() => {
  vi.restoreAllMocks();
  // guarda: qualquer método do model chamado sem mock explícito no teste
  // lança, em vez de tentar se conectar ao Azure SQL real.
  for (const key of Object.keys(rankingModel)) {
    if (typeof rankingModel[key] === 'function') {
      vi.spyOn(rankingModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] ranking.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('ranking.service.atualizarRede', () => {
  it('retorna null quando a rede não existe (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(999, { visivel: false });

    expect(resultado).toBeNull();
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando o novo nome já pertence a outra rede (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(true);

    const resultado = await rankingService.atualizarRede(1, { nome: 'Nome Existente' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.existeRedeComNome).toHaveBeenCalledWith('Nome Existente', 1);
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('não checa duplicidade de nome quando "nome" não foi informado (só visivel)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: false, lojas: [] });

    const resultado = await rankingService.atualizarRede(1, { visivel: false });

    expect(rankingModel.existeRedeComNome).not.toHaveBeenCalled();
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, { nome: undefined, responsavelId: undefined, visivel: false });
    expect(resultado).toEqual({ id: 1, nome: 'Atual', visivel: false, lojas: [] });
  });

  it('atualiza e retorna o objeto completo (com lojas) quando tudo é válido', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(false);
    rankingModel.existeResponsavel.mockResolvedValue(true);
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 1, nome: 'Novo Nome', responsavel: { id: 4, nome: 'Ciclana' }, visivel: true, lojas: [{ id: 10, nome: 'Loja A' }],
    });

    const resultado = await rankingService.atualizarRede(1, { nome: 'Novo Nome', responsavelId: 4, visivel: true });

    expect(rankingModel.existeResponsavel).toHaveBeenCalledWith(4);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, { nome: 'Novo Nome', responsavelId: 4, visivel: true });
    expect(resultado.lojas).toEqual([{ id: 10, nome: 'Loja A' }]);
  });

  it('retorna "responsavel_inexistente" quando responsavelId não corresponde a nenhum Responsaveis.id (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.existeResponsavel.mockResolvedValue(false);

    const resultado = await rankingService.atualizarRede(1, { responsavelId: 999 });

    expect(resultado).toBe('responsavel_inexistente');
    expect(rankingModel.existeResponsavel).toHaveBeenCalledWith(999);
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('não checa existência de responsável quando responsavelId é null (desatribuir)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({ id: 1, nome: 'Atual', responsavel: null, visivel: true, lojas: [] });

    const resultado = await rankingService.atualizarRede(1, { responsavelId: null });

    expect(rankingModel.existeResponsavel).not.toHaveBeenCalled();
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, { nome: undefined, responsavelId: null, visivel: undefined });
    expect(resultado.responsavel).toBeNull();
  });
});

describe('ranking.service.criarRede', () => {
  it('não aceita mais responsavel — cria a rede sem esse campo e ignora o que não for "nome"', async () => {
    rankingModel.existeRedeComNome.mockResolvedValue(false);
    rankingModel.insertRede.mockResolvedValue({
      id: 3, nome: 'Rede Nova', responsavel: null, visivel: true, criado_em: '2026-07-17T14:00:00.000Z',
    });

    const resultado = await rankingService.criarRede({ nome: 'Rede Nova' });

    expect(rankingModel.insertRede).toHaveBeenCalledWith({ nome: 'Rede Nova' });
    expect(resultado).toEqual({
      id: 3, nome: 'Rede Nova', responsavel: null, visivel: true, criado_em: '2026-07-17T14:00:00.000Z', lojas: [],
    });
  });

  it('retorna "nome_duplicado" quando já existe uma rede com o mesmo nome', async () => {
    rankingModel.existeRedeComNome.mockResolvedValue(true);

    const resultado = await rankingService.criarRede({ nome: 'Rede Repetida' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.insertRede).not.toHaveBeenCalled();
  });
});

describe('ranking.service — Responsaveis', () => {
  it('getResponsaveis delega ao model', async () => {
    rankingModel.listResponsaveis.mockResolvedValue([{ id: 1, nome: 'Fulano', criado_em: '2026-01-01T00:00:00.000Z' }]);

    const resultado = await rankingService.getResponsaveis();

    expect(resultado).toEqual([{ id: 1, nome: 'Fulano', criado_em: '2026-01-01T00:00:00.000Z' }]);
  });

  it('criarResponsavel retorna "nome_duplicado" sem inserir quando já existe', async () => {
    rankingModel.existeResponsavelComNome.mockResolvedValue(true);

    const resultado = await rankingService.criarResponsavel({ nome: 'Fulano' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.insertResponsavel).not.toHaveBeenCalled();
  });

  it('criarResponsavel insere e retorna o registro criado quando não há duplicidade', async () => {
    rankingModel.existeResponsavelComNome.mockResolvedValue(false);
    rankingModel.insertResponsavel.mockResolvedValue({ id: 5, nome: 'Beltrano', criado_em: '2026-07-22T10:00:00.000Z' });

    const resultado = await rankingService.criarResponsavel({ nome: 'Beltrano' });

    expect(resultado).toEqual({ id: 5, nome: 'Beltrano', criado_em: '2026-07-22T10:00:00.000Z' });
  });

  it('excluirResponsavel delega ao model e repassa o resultado (not_found/has_redes/deleted)', async () => {
    rankingModel.deleteResponsavelIfNoRedes.mockResolvedValue('has_redes');

    const resultado = await rankingService.excluirResponsavel(5);

    expect(resultado).toBe('has_redes');
    expect(rankingModel.deleteResponsavelIfNoRedes).toHaveBeenCalledWith(5);
  });
});
