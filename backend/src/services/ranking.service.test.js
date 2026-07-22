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
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, { nome: undefined, responsavel: undefined, visivel: false });
    expect(resultado).toEqual({ id: 1, nome: 'Atual', visivel: false, lojas: [] });
  });

  it('atualiza e retorna o objeto completo (com lojas) quando tudo é válido', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, nome: 'Atual', visivel: true });
    rankingModel.existeRedeComNome.mockResolvedValue(false);
    rankingModel.updateRede.mockResolvedValue(undefined);
    rankingModel.getRedeComLojasById.mockResolvedValue({
      id: 1, nome: 'Novo Nome', responsavel: 'Ciclana', visivel: true, lojas: [{ id: 10, nome: 'Loja A' }],
    });

    const resultado = await rankingService.atualizarRede(1, { nome: 'Novo Nome', responsavel: 'Ciclana', visivel: true });

    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, { nome: 'Novo Nome', responsavel: 'Ciclana', visivel: true });
    expect(resultado.lojas).toEqual([{ id: 10, nome: 'Loja A' }]);
  });
});
