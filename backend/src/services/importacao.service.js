const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const importacaoModel = require('../models/importacao.model');

function normalizarTelefone(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Formato real da planilha: 55 + DDD (2 dígitos) + número, ex. 5598984761733.
 * Depois de remover toda formatação, os 2 dígitos do DDD são as posições 3-4
 * (índices 2-3 em 0-based). Telefone com menos de 12 ou mais de 13 dígitos
 * (contando o 55) não tem DDD extraível de forma confiável.
 */
function extrairDDD(telefoneNormalizado) {
  if (telefoneNormalizado.length < 12 || telefoneNormalizado.length > 13) {
    return null;
  }
  return telefoneNormalizado.slice(2, 4);
}

/**
 * Lê a planilha e localiza as colunas NOME/CONTATO de forma case-insensitive
 * na primeira linha (cabeçalho), ignorando linhas totalmente vazias. Cada
 * registro carrega `linha`, o número de linha original na planilha
 * (1-indexed, contando o cabeçalho como linha 1) — usado para gravar
 * LoteImportacaoErros.linha em linhas rejeitadas (erro ou duplicado).
 *
 * O ExcelJS, diferente do SheetJS/xlsx, não detecta o formato sozinho a
 * partir do buffer — exige APIs separadas por formato. `.csv` precisa de um
 * stream (não um buffer), daí a conversão via `Readable.from`.
 */
async function lerPlanilha(buffer, extensao) {
  const workbook = new ExcelJS.Workbook();

  if (extensao === '.csv') {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { colunasEncontradas: false, registros: [] };
  }

  const linhas = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const valores = row.values
      .slice(1)
      .map((celula) => (celula === null || celula === undefined ? '' : celula));
    linhas.push(valores);
  });

  if (linhas.length === 0) {
    return { colunasEncontradas: false, registros: [] };
  }

  const cabecalho = linhas[0].map((celula) => String(celula).trim().toUpperCase());
  const indiceNome = cabecalho.indexOf('NOME');
  const indiceContato = cabecalho.indexOf('CONTATO');

  if (indiceNome === -1 || indiceContato === -1) {
    return { colunasEncontradas: false, registros: [] };
  }

  const registros = [];
  // Começa em 1 (a linha 0 é o cabeçalho); `i + 1` é o número de linha
  // 1-indexed da planilha, contando o cabeçalho como linha 1.
  for (let i = 1; i < linhas.length; i += 1) {
    const linha = linhas[i];
    const vazia = !Array.isArray(linha) || linha.every((celula) => String(celula).trim() === '');
    if (vazia) {
      continue;
    }

    registros.push({
      linha: i + 1,
      nome: String(linha[indiceNome] ?? '').trim(),
      contato: String(linha[indiceContato] ?? '').trim(),
    });
  }

  return { colunasEncontradas: true, registros };
}

/**
 * Lê, valida, agrupa por Estado e persiste o lote + contatos + erros. Nunca
 * atribui numero_remetente_id — a partir da v3 essa escolha acontece no
 * Painel de Disparo, não mais na importação. Retorna 'colunas_ausentes' ou o
 * resumo de sucesso.
 */
async function importarPlanilha({ buffer, nomeArquivo, usuarioId, extensao }) {
  const { colunasEncontradas, registros } = await lerPlanilha(buffer, extensao);

  if (!colunasEncontradas) {
    return 'colunas_ausentes';
  }

  const totalLinhas = registros.length;
  const candidatos = [];
  const erros = [];

  for (const registro of registros) {
    const telefoneNormalizado = normalizarTelefone(registro.contato);
    const ddd = extrairDDD(telefoneNormalizado);

    if (!registro.nome || !ddd) {
      erros.push({
        linha: registro.linha,
        tipo: 'erro',
        nomePlanilha: registro.nome || null,
        contatoPlanilha: telefoneNormalizado || null,
        motivo: !registro.nome ? 'Nome não informado.' : 'Telefone inválido ou incompleto.',
        contatoExistenteId: null,
      });
      continue;
    }

    candidatos.push({ linha: registro.linha, nome: registro.nome, telefone: telefoneNormalizado, ddd });
  }

  const existentesRows = await importacaoModel.listTelefonesExistentes(
    candidatos.map((candidato) => candidato.telefone)
  );
  const existentesPorTelefone = new Map(existentesRows.map((row) => [row.telefone, row.id]));
  const ddds = await importacaoModel.listEstadoDDDs();
  const dddParaEstadoId = new Map(ddds.map((d) => [d.ddd, d.estado_id]));

  let totalDuplicado = 0;
  let totalSemEstado = 0;
  const contatosValidos = [];
  // Telefone duplicado dentro do próprio arquivo (não só contra o banco) —
  // sem essa checagem, duas linhas com o mesmo telefone no mesmo upload
  // colidiriam com o UNIQUE de Contatos.telefone na hora de inserir.
  const telefonesDoLote = new Set();

  for (const candidato of candidatos) {
    const idExistenteNoBanco = existentesPorTelefone.get(candidato.telefone);

    if (idExistenteNoBanco !== undefined) {
      totalDuplicado += 1;
      erros.push({
        linha: candidato.linha,
        tipo: 'duplicado',
        nomePlanilha: candidato.nome,
        contatoPlanilha: candidato.telefone,
        motivo: 'Telefone já cadastrado.',
        contatoExistenteId: idExistenteNoBanco,
      });
      continue;
    }

    if (telefonesDoLote.has(candidato.telefone)) {
      totalDuplicado += 1;
      // Duplicata dentro do próprio arquivo (2ª ocorrência do mesmo
      // telefone no mesmo upload): a 1ª ocorrência ainda não tem
      // Contatos.id neste ponto — só ganha id ao inserir, dentro da mesma
      // transação, em criarLoteEContatos. Não é trivial resolver isso sem
      // reestruturar o INSERT em duas fases, então essa é uma limitação
      // documentada: contatoExistenteId fica NULL só neste sub-caso
      // específico (a linha de erro ainda é gravada normalmente).
      erros.push({
        linha: candidato.linha,
        tipo: 'duplicado',
        nomePlanilha: candidato.nome,
        contatoPlanilha: candidato.telefone,
        motivo: 'Telefone já cadastrado.',
        contatoExistenteId: null,
      });
      continue;
    }
    telefonesDoLote.add(candidato.telefone);

    const estadoId = dddParaEstadoId.get(candidato.ddd) ?? null;
    if (estadoId === null) {
      totalSemEstado += 1;
    }

    contatosValidos.push({
      nome: candidato.nome,
      telefone: candidato.telefone,
      ddd: candidato.ddd,
      estadoId,
    });
  }

  const totalErro = erros.filter((erro) => erro.tipo === 'erro').length;

  const resultado = await importacaoModel.criarLoteEContatos({
    nomeArquivo,
    usuarioId,
    totalLinhas,
    totalSemEstado,
    totalDuplicado,
    totalErro,
    contatos: contatosValidos,
    erros,
  });

  return {
    loteImportacaoId: resultado.loteImportacaoId,
    totalLinhas,
    totalImportados: totalLinhas - totalSemEstado - totalDuplicado - totalErro,
    totalSemEstado,
    totalDuplicado,
    totalErro,
    porEstado: resultado.porEstado,
    criado_em: resultado.criado_em,
  };
}

/**
 * Todos os lotes de importação, mais recentes primeiro (v3 — substitui a
 * extinta "listarPendentes").
 */
async function listarHistorico() {
  return importacaoModel.listHistorico();
}

/**
 * Detalhe de um lote (resumo + porEstado + erros). Retorna null se o lote
 * não existir — o controller decide o 404.
 */
async function buscarDetalhe(loteId) {
  return importacaoModel.getDetalheLote(loteId);
}

module.exports = {
  importarPlanilha,
  listarHistorico,
  buscarDetalhe,
};
