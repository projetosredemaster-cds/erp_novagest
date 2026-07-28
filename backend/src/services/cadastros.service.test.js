// Teste unitário de `cadastros.service`, isolado do Express e do banco real
// via `vi.spyOn` no model (mesma técnica/motivo documentado em
// `../controllers/margens.controller.test.js` e
// `../controllers/ranking.controller.test.js` — `vi.mock()` com sintaxe
// `import` não intercepta requires internos de módulos CJS puros).
//
// Foco: ramificações de `atualizarRede` (a função citada explicitamente no
// plano de QA — decide entre `null` / `'nome_duplicado'` /
// `'diretor_inexistente'` / `'responsavel_inexistente'` / objeto atualizado)
// e `atualizarLoja` (mesma forma, com `'rede_inexistente'` no lugar de
// `'diretor_inexistente'`), além de `criarRede`/`criarLoja`.

const cadastrosModel = require('../models/cadastros.model');
const cadastrosService = require('./cadastros.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(cadastrosModel)) {
    if (typeof cadastrosModel[key] === 'function') {
      vi.spyOn(cadastrosModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] cadastros.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

describe('cadastros.service.atualizarRede', () => {
  it('retorna null quando a rede não existe (não checa mais nada, não chama updateRede)', async () => {
    cadastrosModel.findRedeById.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarRede(999, { nome: 'X' });

    expect(resultado).toBeNull();
    expect(cadastrosModel.existeDiretor).not.toHaveBeenCalled();
    expect(cadastrosModel.updateRede).not.toHaveBeenCalled();
  });

  it('retorna "diretor_inexistente" quando diretorId é informado mas não existe (checado ANTES do nome duplicado)', async () => {
    cadastrosModel.findRedeById.mockResolvedValue({ id: 5, diretor_id: 1, nome: 'Delta' });
    cadastrosModel.existeDiretor.mockResolvedValue(false);

    const resultado = await cadastrosService.atualizarRede(5, { diretorId: 999, nome: 'Delta' });

    expect(resultado).toBe('diretor_inexistente');
    expect(cadastrosModel.existeRedeComNomeNoDiretor).not.toHaveBeenCalled();
    expect(cadastrosModel.updateRede).not.toHaveBeenCalled();
  });

  it('reatribuição bem-sucedida: checa nome duplicado contra o DIRETOR DE DESTINO, não o de origem', async () => {
    cadastrosModel.findRedeById
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', responsavel: null, visivel: true })
      .mockResolvedValueOnce({ id: 5, diretor_id: 2, nome: 'Delta', responsavel: null, visivel: true });
    cadastrosModel.existeDiretor.mockResolvedValue(true);
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    cadastrosModel.updateRede.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarRede(5, { diretorId: 2, nome: 'Delta' });

    expect(cadastrosModel.existeRedeComNomeNoDiretor).toHaveBeenCalledWith({
      nome: 'Delta', diretorId: 2, excludeId: 5,
    });
    expect(cadastrosModel.updateRede).toHaveBeenCalledWith(5, {
      nome: 'Delta', emoji: undefined, responsavelId: undefined, ativo: undefined, visivel: undefined, diretorId: 2,
    });
    expect(resultado.diretor_id).toBe(2);
  });

  it('retorna "nome_duplicado" quando o nome já existe no diretor de destino', async () => {
    cadastrosModel.findRedeById.mockResolvedValue({ id: 5, diretor_id: 1, nome: 'Delta' });
    cadastrosModel.existeDiretor.mockResolvedValue(true);
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(true);

    const resultado = await cadastrosService.atualizarRede(5, { diretorId: 2, nome: 'Lendários' });

    expect(resultado).toBe('nome_duplicado');
    expect(cadastrosModel.updateRede).not.toHaveBeenCalled();
  });

  it('retorna "responsavel_inexistente" quando responsavelId é informado (não-null) mas não existe', async () => {
    cadastrosModel.findRedeById.mockResolvedValue({ id: 5, diretor_id: 1, nome: 'Delta' });
    cadastrosModel.existeResponsavel.mockResolvedValue(false);

    const resultado = await cadastrosService.atualizarRede(5, { responsavelId: 999 });

    expect(resultado).toBe('responsavel_inexistente');
    expect(cadastrosModel.updateRede).not.toHaveBeenCalled();
  });

  it('não checa existência de responsável quando responsavelId é null (desatribuição explícita)', async () => {
    cadastrosModel.findRedeById
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', responsavel: { id: 3, nome: 'Grazy' } })
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', responsavel: null });
    cadastrosModel.updateRede.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarRede(5, { responsavelId: null });

    expect(cadastrosModel.existeResponsavel).not.toHaveBeenCalled();
    expect(resultado.responsavel).toBeNull();
  });

  it('atualiza com sucesso quando só ativo/visivel são enviados (sem nome, sem checagem de duplicidade)', async () => {
    cadastrosModel.findRedeById
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', ativo: true, visivel: true })
      .mockResolvedValueOnce({ id: 5, diretor_id: 1, nome: 'Delta', ativo: false, visivel: true });
    cadastrosModel.updateRede.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarRede(5, { ativo: false });

    expect(cadastrosModel.existeRedeComNomeNoDiretor).not.toHaveBeenCalled();
    expect(resultado.ativo).toBe(false);
  });
});

describe('cadastros.service.atualizarLoja', () => {
  it('retorna null quando a loja não existe', async () => {
    cadastrosModel.findLojaById.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarLoja(999, { nome: 'X' });

    expect(resultado).toBeNull();
    expect(cadastrosModel.existeRede).not.toHaveBeenCalled();
    expect(cadastrosModel.updateLoja).not.toHaveBeenCalled();
  });

  it('retorna "rede_inexistente" quando redeId é informado mas não existe', async () => {
    cadastrosModel.findLojaById.mockResolvedValue({ id: 40, rede_id: 5, nome: 'SLZ 01' });
    cadastrosModel.existeRede.mockResolvedValue(false);

    const resultado = await cadastrosService.atualizarLoja(40, { redeId: 999 });

    expect(resultado).toBe('rede_inexistente');
    expect(cadastrosModel.updateLoja).not.toHaveBeenCalled();
  });

  it('reatribuição bem-sucedida: checa nome duplicado contra a REDE DE DESTINO', async () => {
    cadastrosModel.findLojaById
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01' })
      .mockResolvedValueOnce({ id: 40, rede_id: 6, nome: 'SLZ 01' });
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(false);
    cadastrosModel.updateLoja.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarLoja(40, { redeId: 6, nome: 'SLZ 01' });

    expect(cadastrosModel.existeLojaComNomeNaRede).toHaveBeenCalledWith({
      nome: 'SLZ 01', redeId: 6, excludeId: 40,
    });
    expect(resultado.rede_id).toBe(6);
  });

  it('retorna "nome_duplicado" quando o nome já existe na rede de destino', async () => {
    cadastrosModel.findLojaById.mockResolvedValue({ id: 40, rede_id: 5, nome: 'SLZ 01' });
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(true);

    const resultado = await cadastrosService.atualizarLoja(40, { redeId: 6, nome: 'SLZ 02' });

    expect(resultado).toBe('nome_duplicado');
    expect(cadastrosModel.updateLoja).not.toHaveBeenCalled();
  });

  it('ativo:false não exige checagem de nome/rede (soft-delete simples)', async () => {
    cadastrosModel.findLojaById
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: true })
      .mockResolvedValueOnce({ id: 40, rede_id: 5, nome: 'SLZ 01', ativo: false });
    cadastrosModel.updateLoja.mockResolvedValue(undefined);

    const resultado = await cadastrosService.atualizarLoja(40, { ativo: false });

    expect(cadastrosModel.existeRede).not.toHaveBeenCalled();
    expect(cadastrosModel.existeLojaComNomeNaRede).not.toHaveBeenCalled();
    expect(resultado.ativo).toBe(false);
  });
});

describe('cadastros.service.criarRede', () => {
  it('retorna "diretor_inexistente" quando o diretor não existe', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue(undefined);

    const resultado = await cadastrosService.criarRede({ diretorId: 999, nome: 'Delta' });

    expect(resultado).toBe('diretor_inexistente');
    expect(cadastrosModel.existeRedeComNomeNoDiretor).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando já existe rede com esse nome no diretor', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(true);

    const resultado = await cadastrosService.criarRede({ diretorId: 1, nome: 'Delta' });

    expect(resultado).toBe('nome_duplicado');
    expect(cadastrosModel.insertRede).not.toHaveBeenCalled();
  });

  it('cria a rede com sucesso', async () => {
    cadastrosModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    cadastrosModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    cadastrosModel.insertRede.mockResolvedValue({
      id: 12, diretor_id: 1, nome: 'Nova Rede', emoji: null, ativo: true, visivel: true,
      responsavel: null, criado_em: '2026-07-28T10:00:00.000Z',
    });

    const resultado = await cadastrosService.criarRede({ diretorId: 1, nome: 'Nova Rede' });

    expect(resultado.id).toBe(12);
    expect(resultado.responsavel).toBeNull();
  });
});

describe('cadastros.service.criarLoja', () => {
  it('retorna "rede_inexistente" quando a rede não existe', async () => {
    cadastrosModel.existeRede.mockResolvedValue(false);

    const resultado = await cadastrosService.criarLoja({ redeId: 999, nome: 'SLZ 03' });

    expect(resultado).toBe('rede_inexistente');
    expect(cadastrosModel.existeLojaComNomeNaRede).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando já existe loja com esse nome na rede', async () => {
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(true);

    const resultado = await cadastrosService.criarLoja({ redeId: 5, nome: 'SLZ 01' });

    expect(resultado).toBe('nome_duplicado');
    expect(cadastrosModel.insertLoja).not.toHaveBeenCalled();
  });

  it('cria a loja com sucesso', async () => {
    cadastrosModel.existeRede.mockResolvedValue(true);
    cadastrosModel.existeLojaComNomeNaRede.mockResolvedValue(false);
    cadastrosModel.insertLoja.mockResolvedValue({
      id: 42, rede_id: 5, nome: 'SLZ 03', ativo: true, criado_em: '2026-07-28T10:00:00.000Z',
    });

    const resultado = await cadastrosService.criarLoja({ redeId: 5, nome: 'SLZ 03' });

    expect(resultado).toEqual({
      id: 42, rede_id: 5, nome: 'SLZ 03', ativo: true, criado_em: '2026-07-28T10:00:00.000Z',
    });
  });
});

describe('cadastros.service.excluirRede', () => {
  it.each(['not_found', 'has_lojas', 'has_entradas', 'deleted'])(
    'repassa o retorno "%s" do model tal como veio',
    async (retorno) => {
      cadastrosModel.deleteRedeIfNoEntradas.mockResolvedValue(retorno);

      const resultado = await cadastrosService.excluirRede(5);

      expect(resultado).toBe(retorno);
    }
  );
});
