const importacaoModel = require('../models/importacao.model');
const importacaoService = require('./importacao.service');

beforeEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(importacaoModel)) {
    if (typeof importacaoModel[key] === 'function') {
      vi.spyOn(importacaoModel, key).mockImplementation(() => {
        throw new Error(
          `[guarda de teste] importacao.model.${key} foi chamado sem mock explícito — ` +
          'isso teria tentado uma conexão real com o Azure SQL.'
        );
      });
    }
  }
});

function mockModelBasico({ existentes = [], ddds = [] } = {}) {
  importacaoModel.listTelefonesExistentes.mockResolvedValue(existentes);
  importacaoModel.listEstadoDDDs.mockResolvedValue(ddds);
  importacaoModel.criarLoteEContatos.mockResolvedValue({
    loteImportacaoId: 1,
    criado_em: '2026-01-01T00:00:00.000Z',
    porEstado: [],
  });
}

describe('importacao.service.importarPlanilha — leitura/parsing (.csv)', () => {
  it('retorna "colunas_ausentes" quando o cabeçalho não tem NOME/CONTATO, sem tocar o model', async () => {
    const csv = 'NAME,PHONE\nFulano,5598984761733\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado).toBe('colunas_ausentes');
    expect(importacaoModel.criarLoteEContatos).not.toHaveBeenCalled();
  });

  it('reconhece as colunas NOME/CONTATO case-insensitive e fora de ordem', async () => {
    mockModelBasico({ ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }] });
    const csv = 'contato,nome\n5598984761733,Fulano de Tal\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalLinhas).toBe(1);
    expect(resultado.totalErro).toBe(0);
    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({
        contatos: [expect.objectContaining({ nome: 'Fulano de Tal', telefone: '5598984761733', ddd: '98', estadoId: 6 })],
      })
    );
  });

  it('ignora linhas totalmente vazias sem contar como erro', async () => {
    mockModelBasico({ ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }] });
    const csv = 'NOME,CONTATO\nFulano,5598984761733\n,\n\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalLinhas).toBe(1);
  });
});

describe('importacao.service.importarPlanilha — extração de DDD e erro de linha', () => {
  it('rejeita (total_erro) linha com NOME vazio mesmo com telefone válido', async () => {
    mockModelBasico({ ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }] });
    const csv = 'NOME,CONTATO\n,5598984761733\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalErro).toBe(1);
    expect(resultado.totalImportados).toBe(0);
  });

  it('rejeita (total_erro) telefone com menos de 12 dígitos (sem DDD extraível)', async () => {
    mockModelBasico({ ddds: [] });
    // telefone com 10 dígitos totais (menos que o mínimo de 12)
    const csvCurto = 'NOME,CONTATO\nFulano,5598476173\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csvCurto), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalErro).toBe(1);
  });

  it('rejeita (total_erro) telefone com mais de 13 dígitos', async () => {
    mockModelBasico({ ddds: [] });
    const csv = 'NOME,CONTATO\nFulano,559898476173312\n'; // 15 dígitos

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalErro).toBe(1);
  });

  it('aceita telefone com 12 dígitos (DDD + 8 dígitos) e com 13 dígitos (DDD + 9 dígitos)', async () => {
    mockModelBasico({ ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }] });
    const csv = 'NOME,CONTATO\nOito Digitos,559884761733\nNove Digitos,5598984761733\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalErro).toBe(0);
    expect(resultado.totalLinhas).toBe(2);
  });

  it('extrai o DDD das posições 3-4 (depois do 55 inicial), ignorando formatação (parênteses, traço, espaço)', async () => {
    mockModelBasico({ ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }] });
    const csv = 'NOME,CONTATO\nFulano,"55 (98) 98476-1733"\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({
        contatos: [expect.objectContaining({ ddd: '98', telefone: '5598984761733' })],
      })
    );
    expect(resultado.totalErro).toBe(0);
  });

  it('grava estado_id NULL e conta em total_sem_estado quando o DDD não está cadastrado em nenhum Estado', async () => {
    mockModelBasico({ ddds: [] }); // nenhum DDD cadastrado
    const csv = 'NOME,CONTATO\nFulano,5511988887777\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalSemEstado).toBe(1);
    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({
        contatos: [expect.objectContaining({ estadoId: null })],
      })
    );
  });
});

describe('importacao.service.importarPlanilha — duplicidade de telefone', () => {
  it('conta em total_duplicado um telefone já existente em Contatos (globalmente, não só no lote atual)', async () => {
    mockModelBasico({
      existentes: ['5598984761733'],
      ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }],
    });
    const csv = 'NOME,CONTATO\nJa Existe,5598984761733\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalDuplicado).toBe(1);
    expect(resultado.totalImportados).toBe(0);
    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({ contatos: [] })
    );
  });

  it('conta em total_duplicado a 2ª ocorrência de um telefone repetido dentro do mesmo arquivo (assunção documentada)', async () => {
    mockModelBasico({
      existentes: [],
      ddds: [{ ddd: '98', estado_id: 6, estado_nome: 'Maranhão', estado_uf: 'MA' }],
    });
    const csv = 'NOME,CONTATO\nPrimeira Vez,5598984761733\nSegunda Vez,5598984761733\n';

    const resultado = await importacaoService.importarPlanilha({
      buffer: Buffer.from(csv), nomeArquivo: 'x.csv', usuarioId: 1, extensao: '.csv',
    });

    expect(resultado.totalDuplicado).toBe(1);
    expect(resultado.totalImportados).toBe(1);
    expect(importacaoModel.criarLoteEContatos).toHaveBeenCalledWith(
      expect.objectContaining({
        contatos: [expect.objectContaining({ nome: 'Primeira Vez' })],
      })
    );
  });
});

describe('importacao.service.confirmarLote', () => {
  it('normaliza estadoId/numeroRemetenteId para número antes de delegar ao model', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({ status: 'confirmado' });

    await importacaoService.confirmarLote({
      loteId: 12,
      escolhas: [{ estadoId: '6', numeroRemetenteId: '3' }],
    });

    expect(importacaoModel.confirmarLote).toHaveBeenCalledWith({
      loteId: 12,
      escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }],
    });
  });

  it('propaga o status retornado pelo model sem alteração', async () => {
    importacaoModel.confirmarLote.mockResolvedValue({ status: 'numero_invalido', estadoNome: 'Maranhão' });

    const resultado = await importacaoService.confirmarLote({ loteId: 12, escolhas: [{ estadoId: 6, numeroRemetenteId: 3 }] });

    expect(resultado).toEqual({ status: 'numero_invalido', estadoNome: 'Maranhão' });
  });
});

describe('importacao.service.listarPendentes', () => {
  it('delega direto para o model', async () => {
    importacaoModel.listLotesPendentes.mockResolvedValue([{ loteImportacaoId: 12 }]);

    const resultado = await importacaoService.listarPendentes();

    expect(resultado).toEqual([{ loteImportacaoId: 12 }]);
  });
});
