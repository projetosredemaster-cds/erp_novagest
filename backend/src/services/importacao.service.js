const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const importacaoModel = require('../models/importacao.model');

function normalizarTelefone(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

function extrairDDD(telefoneNormalizado) {
  if (telefoneNormalizado.length < 12 || telefoneNormalizado.length > 13) {
    return null;
  }
  return telefoneNormalizado.slice(2, 4);
}

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

async function listarHistorico() {
  return importacaoModel.listHistorico();
}

async function buscarDetalhe(loteId) {
  return importacaoModel.getDetalheLote(loteId);
}

module.exports = {
  importarPlanilha,
  listarHistorico,
  buscarDetalhe,
};
