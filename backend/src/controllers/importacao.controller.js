const importacaoService = require('../services/importacao.service');

const EXTENSOES_SUPORTADAS = ['.xlsx', '.csv'];

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

async function importar(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'Arquivo é obrigatório.' });
  }

  const nomeArquivo = req.file.originalname || '';
  const pontoIndex = nomeArquivo.lastIndexOf('.');
  const extensao = pontoIndex >= 0 ? nomeArquivo.slice(pontoIndex).toLowerCase() : '';

  if (!EXTENSOES_SUPORTADAS.includes(extensao)) {
    return res.status(400).json({ error: 'Formato de arquivo não suportado. Envie .xlsx ou .csv.' });
  }

  try {
    const resultado = await importacaoService.importarPlanilha({
      buffer: req.file.buffer,
      nomeArquivo,
      usuarioId: req.usuario.id,
      extensao,
    });

    if (resultado === 'colunas_ausentes') {
      return res.status(400).json({
        error: 'A planilha deve conter as colunas "NOME" e "CONTATO".',
      });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[importacao.controller] Erro ao importar contatos:', err);
    return res.status(500).json({ error: 'Erro interno ao importar contatos.' });
  }
}

async function confirmar(req, res) {
  const loteIdNum = Number(req.params.loteId);
  if (!isPositiveInteger(loteIdNum)) {
    return res.status(400).json({ error: 'Lote de importação não encontrado.' });
  }

  const body = req.body || {};
  const { escolhas } = body;

  if (!Array.isArray(escolhas) || escolhas.length === 0) {
    return res.status(400).json({ error: 'Campo "escolhas" é obrigatório.' });
  }

  const escolhasComFormatoValido = escolhas.every(
    (escolha) =>
      escolha &&
      isPositiveInteger(Number(escolha.estadoId)) &&
      isPositiveInteger(Number(escolha.numeroRemetenteId))
  );
  if (!escolhasComFormatoValido) {
    return res.status(400).json({ error: 'Campo "escolhas" é obrigatório.' });
  }

  try {
    const resultado = await importacaoService.confirmarLote({ loteId: loteIdNum, escolhas });

    if (resultado.status === 'lote_nao_encontrado') {
      return res.status(400).json({ error: 'Lote de importação não encontrado.' });
    }

    if (resultado.status === 'ja_confirmado') {
      return res.status(400).json({ error: 'Este lote já foi confirmado anteriormente.' });
    }

    if (resultado.status === 'numero_invalido') {
      return res.status(400).json({
        error: `Número remetente informado é inválido para o estado "${resultado.estadoNome}".`,
      });
    }

    if (resultado.status === 'faltando_escolha') {
      return res.status(400).json({
        error: 'É necessário escolher um número para todos os estados deste lote.',
      });
    }

    return res.status(200).json({ loteImportacaoId: loteIdNum, confirmado: true });
  } catch (err) {
    console.error('[importacao.controller] Erro ao confirmar importação:', err);
    return res.status(500).json({ error: 'Erro interno ao confirmar importação.' });
  }
}

async function listarPendentes(req, res) {
  try {
    const pendentes = await importacaoService.listarPendentes();
    return res.json(pendentes);
  } catch (err) {
    console.error('[importacao.controller] Erro ao listar importações pendentes:', err);
    return res.status(500).json({ error: 'Erro interno ao listar importações pendentes.' });
  }
}

module.exports = {
  importar,
  confirmar,
  listarPendentes,
};
