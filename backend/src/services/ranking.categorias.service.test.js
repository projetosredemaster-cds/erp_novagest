// Teste unitário de `ranking.service` — só as funções de Categorias
// (`criarCategoria`/`atualizarCategoria`/`excluirCategoria`), isolado do
// Express e do banco real via `vi.spyOn` no model (ver nota detalhada em
// `../controllers/ranking.controller.test.js` sobre por que `vi.mock()` não
// é seguro aqui).
//
// Arquivo separado de `ranking.service.test.js` de propósito: aquele arquivo
// testa `criarDiretor`/`atualizarDiretor`/`criarRede`/`atualizarRede`, que
// NÃO existem mais em `ranking.service.js` (migraram para
// `cadastros.service.js`) — está 100% quebrado, débito técnico pré-existente
// fora do escopo desta validação.

const rankingModel = require('../models/ranking.model');
const rankingService = require('./ranking.service');

beforeEach(() => {
  vi.restoreAllMocks();
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

describe('ranking.service.criarCategoria', () => {
  it('retorna "nome_duplicado" sem inserir quando já existe uma categoria com o mesmo nome', async () => {
    rankingModel.existeCategoriaComNome.mockResolvedValue(true);

    const resultado = await rankingService.criarCategoria({ nome: 'Receita Bruta' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.insertCategoria).not.toHaveBeenCalled();
  });

  it('insere e retorna a categoria criada quando o nome é livre', async () => {
    rankingModel.existeCategoriaComNome.mockResolvedValue(false);
    rankingModel.insertCategoria.mockResolvedValue({
      id: 5, nome: 'Categoria Nova', principal: false, padrao: false, visivel: true,
      criado_em: '2026-07-28T10:00:00.000Z',
    });

    const resultado = await rankingService.criarCategoria({ nome: 'Categoria Nova' });

    expect(resultado).toEqual({
      id: 5, nome: 'Categoria Nova', principal: false, padrao: false, visivel: true,
      criado_em: '2026-07-28T10:00:00.000Z',
    });
    expect(rankingModel.insertCategoria).toHaveBeenCalledWith({ nome: 'Categoria Nova' });
  });
});

describe('ranking.service.atualizarCategoria', () => {
  it('retorna null quando a categoria não existe (não chama updateCategoria nem checa duplicidade)', async () => {
    rankingModel.findCategoriaById.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarCategoria(999, { nome: 'X', visivel: undefined });

    expect(resultado).toBeNull();
    expect(rankingModel.updateCategoria).not.toHaveBeenCalled();
    expect(rankingModel.existeCategoriaComNome).not.toHaveBeenCalled();
  });

  it('não checa duplicidade quando nome não foi enviado (só visivel mudou)', async () => {
    rankingModel.findCategoriaById
      .mockResolvedValueOnce({ id: 4, nome: 'Categoria X', padrao: false, principal: false, visivel: true })
      .mockResolvedValueOnce({ id: 4, nome: 'Categoria X', padrao: false, principal: false, visivel: false });
    rankingModel.updateCategoria.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarCategoria(4, { nome: undefined, visivel: false });

    expect(rankingModel.existeCategoriaComNome).not.toHaveBeenCalled();
    expect(rankingModel.updateCategoria).toHaveBeenCalledWith(4, { nome: undefined, visivel: false });
    expect(resultado.visivel).toBe(false);
  });

  it('retorna "nome_duplicado" quando o novo nome já pertence a outra categoria (exclui a própria id da checagem)', async () => {
    rankingModel.findCategoriaById.mockResolvedValue({ id: 4, nome: 'Categoria X', padrao: false, principal: false, visivel: true });
    rankingModel.existeCategoriaComNome.mockResolvedValue(true);

    const resultado = await rankingService.atualizarCategoria(4, { nome: 'Já Existe' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.existeCategoriaComNome).toHaveBeenCalledWith('Já Existe', 4);
    expect(rankingModel.updateCategoria).not.toHaveBeenCalled();
  });

  it('atualiza e retorna o objeto completo quando o nome é livre', async () => {
    rankingModel.findCategoriaById
      .mockResolvedValueOnce({ id: 4, nome: 'Antigo', padrao: false, principal: false, visivel: true })
      .mockResolvedValueOnce({ id: 4, nome: 'Novo Nome', padrao: false, principal: false, visivel: true });
    rankingModel.existeCategoriaComNome.mockResolvedValue(false);
    rankingModel.updateCategoria.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarCategoria(4, { nome: 'Novo Nome' });

    expect(resultado.nome).toBe('Novo Nome');
    expect(rankingModel.updateCategoria).toHaveBeenCalledWith(4, { nome: 'Novo Nome', visivel: undefined });
  });
});

describe('ranking.service.excluirCategoria', () => {
  it.each(['not_found', 'is_padrao', 'has_entradas', 'deleted'])(
    'repassa o retorno "%s" do model tal como veio (não reinterpreta)',
    async (retorno) => {
      rankingModel.deleteCategoriaIfAllowed.mockResolvedValue(retorno);

      const resultado = await rankingService.excluirCategoria(4);

      expect(resultado).toBe(retorno);
      expect(rankingModel.deleteCategoriaIfAllowed).toHaveBeenCalledWith(4);
    }
  );
});
