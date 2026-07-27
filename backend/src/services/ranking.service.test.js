// Teste unitário de `ranking.service`, isolado do Express e do banco real —
// `ranking.model` é substituído por spies (`vi.spyOn`) que sobrescrevem os
// métodos no MESMO objeto que `ranking.service.js` usa internamente
// (garantido pelo cache de módulos do Node, compartilhado entre requires
// CJS) — ver nota detalhada em `../controllers/ranking.controller.test.js`
// sobre por que `vi.mock()` não é confiável aqui (chegou a golpear o Azure
// SQL real em um teste exploratório).
//
// Migrado do contrato antigo (2 níveis, Rede -> Loja) para o contrato v2
// (Diretor -> Rede, ver CONTRATO-RANKING-API.md): cobre as ramificações de
// retorno de `atualizarRede`/`criarRede`/`criarDiretor`/`atualizarDiretor`
// (`null` / `'nome_duplicado'` / `'diretor_inexistente'` /
// `'responsavel_inexistente'` / objeto atualizado) e confirma que
// `visivel`/`ativo`/`emoji` são repassados ao model como qualquer outro
// campo parcial.

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

describe('ranking.service.criarDiretor', () => {
  it('retorna "nome_duplicado" sem inserir quando já existe um diretor com o mesmo nome', async () => {
    rankingModel.existeDiretorComNome.mockResolvedValue(true);

    const resultado = await rankingService.criarDiretor({ nome: 'Repetido' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.insertDiretor).not.toHaveBeenCalled();
  });

  it('insere e retorna o diretor criado com redes: []', async () => {
    rankingModel.existeDiretorComNome.mockResolvedValue(false);
    rankingModel.insertDiretor.mockResolvedValue({ id: 4, nome: 'Novo Diretor', criado_em: '2026-07-27T14:00:00.000Z' });

    const resultado = await rankingService.criarDiretor({ nome: 'Novo Diretor' });

    expect(resultado).toEqual({ id: 4, nome: 'Novo Diretor', criado_em: '2026-07-27T14:00:00.000Z', redes: [] });
  });
});

describe('ranking.service.atualizarDiretor', () => {
  it('retorna null quando o diretor não existe (não chama updateDiretor)', async () => {
    rankingModel.findDiretorById.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarDiretor(999, { nome: 'X' });

    expect(resultado).toBeNull();
    expect(rankingModel.updateDiretor).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando o novo nome já pertence a outro diretor', async () => {
    rankingModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Atual' });
    rankingModel.existeDiretorComNome.mockResolvedValue(true);

    const resultado = await rankingService.atualizarDiretor(1, { nome: 'Nome Existente' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.existeDiretorComNome).toHaveBeenCalledWith('Nome Existente', 1);
    expect(rankingModel.updateDiretor).not.toHaveBeenCalled();
  });

  it('atualiza e retorna o objeto completo (com redes[]) quando tudo é válido', async () => {
    rankingModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Atual' });
    rankingModel.existeDiretorComNome.mockResolvedValue(false);
    rankingModel.updateDiretor.mockResolvedValue(undefined);
    rankingModel.getDiretorComRedesById.mockResolvedValue({ id: 1, nome: 'Novo Nome', redes: [{ id: 10, nome: 'Delta' }] });

    const resultado = await rankingService.atualizarDiretor(1, { nome: 'Novo Nome' });

    expect(rankingModel.updateDiretor).toHaveBeenCalledWith(1, { nome: 'Novo Nome' });
    expect(resultado.redes).toEqual([{ id: 10, nome: 'Delta' }]);
  });
});

describe('ranking.service.excluirDiretor', () => {
  it('repassa o resultado do model (not_found/has_redes/deleted)', async () => {
    rankingModel.deleteDiretorIfNoRedes.mockResolvedValue('has_redes');

    const resultado = await rankingService.excluirDiretor(1);

    expect(resultado).toBe('has_redes');
    expect(rankingModel.deleteDiretorIfNoRedes).toHaveBeenCalledWith(1);
  });
});

describe('ranking.service.criarRede', () => {
  it('retorna "diretor_inexistente" sem checar duplicidade nem inserir quando o diretor não existe', async () => {
    rankingModel.findDiretorById.mockResolvedValue(undefined);

    const resultado = await rankingService.criarRede({ diretorId: 999, nome: 'Delta' });

    expect(resultado).toBe('diretor_inexistente');
    expect(rankingModel.existeRedeComNomeNoDiretor).not.toHaveBeenCalled();
    expect(rankingModel.insertRede).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando já existe uma rede com o mesmo nome no mesmo diretor', async () => {
    rankingModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    rankingModel.existeRedeComNomeNoDiretor.mockResolvedValue(true);

    const resultado = await rankingService.criarRede({ diretorId: 1, nome: 'Rede Repetida' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.existeRedeComNomeNoDiretor).toHaveBeenCalledWith({ nome: 'Rede Repetida', diretorId: 1 });
    expect(rankingModel.insertRede).not.toHaveBeenCalled();
  });

  it('não aceita mais responsavel na criação — cria a rede só com diretorId/nome/emoji', async () => {
    rankingModel.findDiretorById.mockResolvedValue({ id: 1, nome: 'Victor Hugo' });
    rankingModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    rankingModel.insertRede.mockResolvedValue({
      id: 3, diretor_id: 1, nome: 'Rede Nova', emoji: '🆕', ativo: true, visivel: true,
      responsavel: null, criado_em: '2026-07-17T14:00:00.000Z',
    });

    const resultado = await rankingService.criarRede({ diretorId: 1, nome: 'Rede Nova', emoji: '🆕' });

    expect(rankingModel.insertRede).toHaveBeenCalledWith({ diretorId: 1, nome: 'Rede Nova', emoji: '🆕' });
    expect(resultado).toEqual({
      id: 3, diretor_id: 1, nome: 'Rede Nova', emoji: '🆕', ativo: true, visivel: true,
      responsavel: null, criado_em: '2026-07-17T14:00:00.000Z',
    });
  });
});

describe('ranking.service.atualizarRede', () => {
  it('retorna null quando a rede não existe (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(999, { visivel: false });

    expect(resultado).toBeNull();
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('retorna "nome_duplicado" quando o novo nome já pertence a outra rede do mesmo diretor (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true });
    rankingModel.existeRedeComNomeNoDiretor.mockResolvedValue(true);

    const resultado = await rankingService.atualizarRede(1, { nome: 'Nome Existente' });

    expect(resultado).toBe('nome_duplicado');
    expect(rankingModel.existeRedeComNomeNoDiretor).toHaveBeenCalledWith({
      nome: 'Nome Existente', diretorId: 7, excludeId: 1,
    });
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('não checa duplicidade de nome quando "nome" não foi informado (só visivel)', async () => {
    rankingModel.findRedeById
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true })
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: false, redes: undefined });
    rankingModel.updateRede.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(1, { visivel: false });

    expect(rankingModel.existeRedeComNomeNoDiretor).not.toHaveBeenCalled();
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, {
      nome: undefined, emoji: undefined, responsavelId: undefined, ativo: undefined, visivel: false,
    });
    expect(resultado.visivel).toBe(false);
  });

  it('atualiza e retorna o objeto completo quando tudo é válido (nome dentro do mesmo diretor + responsavelId + visivel)', async () => {
    rankingModel.findRedeById
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true })
      .mockResolvedValueOnce({
        id: 1, diretor_id: 7, nome: 'Novo Nome', responsavel: { id: 4, nome: 'Ciclana' }, visivel: true,
      });
    rankingModel.existeRedeComNomeNoDiretor.mockResolvedValue(false);
    rankingModel.existeResponsavel.mockResolvedValue(true);
    rankingModel.updateRede.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(1, { nome: 'Novo Nome', responsavelId: 4, visivel: true });

    expect(rankingModel.existeResponsavel).toHaveBeenCalledWith(4);
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, {
      nome: 'Novo Nome', emoji: undefined, responsavelId: 4, ativo: undefined, visivel: true,
    });
    expect(resultado.responsavel).toEqual({ id: 4, nome: 'Ciclana' });
  });

  it('retorna "responsavel_inexistente" quando responsavelId não corresponde a nenhum Responsaveis.id (não chama updateRede)', async () => {
    rankingModel.findRedeById.mockResolvedValue({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true });
    rankingModel.existeResponsavel.mockResolvedValue(false);

    const resultado = await rankingService.atualizarRede(1, { responsavelId: 999 });

    expect(resultado).toBe('responsavel_inexistente');
    expect(rankingModel.existeResponsavel).toHaveBeenCalledWith(999);
    expect(rankingModel.updateRede).not.toHaveBeenCalled();
  });

  it('não checa existência de responsável quando responsavelId é null (desatribuir)', async () => {
    rankingModel.findRedeById
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true })
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', responsavel: null, visivel: true });
    rankingModel.updateRede.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(1, { responsavelId: null });

    expect(rankingModel.existeResponsavel).not.toHaveBeenCalled();
    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, {
      nome: undefined, emoji: undefined, responsavelId: null, ativo: undefined, visivel: undefined,
    });
    expect(resultado.responsavel).toBeNull();
  });

  it('repassa "ativo" e "emoji" como qualquer outro campo parcial', async () => {
    rankingModel.findRedeById
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true, ativo: true })
      .mockResolvedValueOnce({ id: 1, diretor_id: 7, nome: 'Atual', visivel: true, ativo: false, emoji: '🆕' });
    rankingModel.updateRede.mockResolvedValue(undefined);

    const resultado = await rankingService.atualizarRede(1, { ativo: false, emoji: '🆕' });

    expect(rankingModel.updateRede).toHaveBeenCalledWith(1, {
      nome: undefined, emoji: '🆕', responsavelId: undefined, ativo: false, visivel: undefined,
    });
    expect(resultado.ativo).toBe(false);
    expect(resultado.emoji).toBe('🆕');
  });
});

describe('ranking.service.excluirRede', () => {
  it('repassa o resultado do model (not_found/has_entradas/deleted)', async () => {
    rankingModel.deleteRedeIfNoEntradas.mockResolvedValue('has_entradas');

    const resultado = await rankingService.excluirRede(5);

    expect(resultado).toBe('has_entradas');
    expect(rankingModel.deleteRedeIfNoEntradas).toHaveBeenCalledWith(5);
  });
});

describe('ranking.service.salvarEntrada', () => {
  it('repassa redeId (renomeado de lojaId) ao model.upsertEntrada', async () => {
    rankingModel.upsertEntrada.mockResolvedValue({
      acao: 'INSERT', id: 101, data_ref: '2026-07-17', categoria_id: 1, rede_id: 5, valor: 100, atualizado_em: '2026-07-17',
    });

    const resultado = await rankingService.salvarEntrada({ data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 100 });

    expect(rankingModel.upsertEntrada).toHaveBeenCalledWith({ data: '2026-07-17', categoriaId: 1, redeId: 5, valor: 100 });
    expect(resultado.rede_id).toBe(5);
  });
});

describe('ranking.service — Responsaveis (vínculo agora é com Rede, não Diretor)', () => {
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

  it('excluirResponsavel delega ao model (checagem de vínculo é contra Redes.responsavel_id, transparente ao service)', async () => {
    rankingModel.deleteResponsavelIfNoRedes.mockResolvedValue('has_redes');

    const resultado = await rankingService.excluirResponsavel(5);

    expect(resultado).toBe('has_redes');
    expect(rankingModel.deleteResponsavelIfNoRedes).toHaveBeenCalledWith(5);
  });
});
