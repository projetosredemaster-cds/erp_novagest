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

/**
 * Descontinuada em v3 — a escolha de número por Estado passou a acontecer
 * no Painel de Disparo, no momento do disparo (ver disparos.controller.js).
 * A rota continua montada (não removida do router) só para responder um 410
 * claro em vez de um 404 genérico para quem ainda chamar o fluxo antigo.
 */
async function confirmar(req, res) {
  return res.status(410).json({
    error: 'Rota descontinuada. A escolha de número acontece no Painel de Disparo.',
  });
}

async function historico(req, res) {
  try {
    const lotes = await importacaoService.listarHistorico();
    return res.json(lotes);
  } catch (err) {
    console.error('[importacao.controller] Erro ao listar histórico de importações:', err);
    return res.status(500).json({ error: 'Erro interno ao listar histórico de importações.' });
  }
}

async function detalhe(req, res) {
  const loteIdNum = Number(req.params.loteId);
  if (!isPositiveInteger(loteIdNum)) {
    return res.status(404).json({ error: 'Importação não encontrada.' });
  }

  try {
    const lote = await importacaoService.buscarDetalhe(loteIdNum);

    if (!lote) {
      return res.status(404).json({ error: 'Importação não encontrada.' });
    }

    return res.json(lote);
  } catch (err) {
    console.error('[importacao.controller] Erro ao buscar detalhe da importação:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar detalhe da importação.' });
  }
}

module.exports = {
  importar,
  confirmar,
  historico,
  detalhe,
};
