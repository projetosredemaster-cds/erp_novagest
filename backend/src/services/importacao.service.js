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
 * na primeira linha (cabeçalho), ignorando linhas totalmente vazias.
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

  const registros = linhas
    .slice(1)
    .filter((linha) => Array.isArray(linha) && linha.some((celula) => String(celula).trim() !== ''))
    .map((linha) => ({
      nome: String(linha[indiceNome] ?? '').trim(),
      contato: String(linha[indiceContato] ?? '').trim(),
    }));

  return { colunasEncontradas: true, registros };
}

/**
 * Lê, valida, agrupa por Estado e persiste o lote + contatos. Nunca atribui
 * numero_remetente_id — isso só acontece na confirmação (confirmarLote).
 * Retorna 'colunas_ausentes' ou o resumo de sucesso.
 */
async function importarPlanilha({ buffer, nomeArquivo, usuarioId, extensao }) {
  const { colunasEncontradas, registros } = await lerPlanilha(buffer, extensao);

  if (!colunasEncontradas) {
    return 'colunas_ausentes';
  }

  const totalLinhas = registros.length;
  const candidatos = [];
  let totalErro = 0;

  for (const registro of registros) {
    const telefoneNormalizado = normalizarTelefone(registro.contato);
    const ddd = extrairDDD(telefoneNormalizado);

    if (!registro.nome || !ddd) {
      totalErro += 1;
      continue;
    }

    candidatos.push({ nome: registro.nome, telefone: telefoneNormalizado, ddd });
  }

  const telefonesExistentes = new Set(
    await importacaoModel.listTelefonesExistentes(candidatos.map((c) => c.telefone))
  );
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
    if (telefonesExistentes.has(candidato.telefone) || telefonesDoLote.has(candidato.telefone)) {
      totalDuplicado += 1;
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

  const resultado = await importacaoModel.criarLoteEContatos({
    nomeArquivo,
    usuarioId,
    totalLinhas,
    totalSemEstado,
    totalDuplicado,
    totalErro,
    contatos: contatosValidos,
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

async function confirmarLote({ loteId, escolhas }) {
  const escolhasNormalizadas = escolhas.map((escolha) => ({
    estadoId: Number(escolha && escolha.estadoId),
    numeroRemetenteId: Number(escolha && escolha.numeroRemetenteId),
  }));

  return importacaoModel.confirmarLote({ loteId, escolhas: escolhasNormalizadas });
}

async function listarPendentes() {
  return importacaoModel.listLotesPendentes();
}

module.exports = {
  importarPlanilha,
  confirmarLote,
  listarPendentes,
};
