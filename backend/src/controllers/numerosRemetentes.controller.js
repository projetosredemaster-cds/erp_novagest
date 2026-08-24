const numerosRemetentesService = require('../services/numerosRemetentes.service');
const baileysSessionService = require('../services/baileysSession.service');

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function listar(req, res) {
  try {
    const numeros = await numerosRemetentesService.listarNumeros();
    return res.json(numeros);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao listar números remetentes:', err);
    return res.status(500).json({ error: 'Erro interno ao listar números remetentes.' });
  }
}

async function criar(req, res) {
  const body = req.body || {};
  const { apelido, estadoId } = body;

  if (!isNonEmptyString(apelido)) {
    return res.status(400).json({ error: 'Campo "apelido" é obrigatório.' });
  }

  const estadoIdNum = Number(estadoId);
  if (!isPositiveInteger(estadoIdNum)) {
    return res.status(400).json({ error: 'Estado informado não existe.' });
  }

  try {
    const resultado = await numerosRemetentesService.criarNumero({
      apelido: apelido.trim(),
      estadoId: estadoIdNum,
    });

    if (resultado === 'estado_inexistente') {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }

    return res.status(201).json(resultado);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao criar número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao criar número remetente.' });
  }
}

async function atualizar(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  const body = req.body || {};
  const { apelido, estadoId, ativo, nomeColaboradora } = body;

  if (apelido !== undefined && !isNonEmptyString(apelido)) {
    return res.status(400).json({ error: 'Campo "apelido", quando enviado, não pode ser vazio.' });
  }

  let estadoIdValue;
  if (estadoId !== undefined) {
    estadoIdValue = Number(estadoId);
    if (!isPositiveInteger(estadoIdValue)) {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }
  }

  if (ativo !== undefined && typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'Campo "ativo", quando enviado, deve ser "true" ou "false".' });
  }

  // nomeColaboradora: ausente -> não mexe; string vazia ou null -> limpa
  // (grava NULL); string não vazia -> grava (trim); qualquer outro tipo -> 400.
  let nomeColaboradoraValue;
  if (nomeColaboradora !== undefined) {
    if (nomeColaboradora !== null && typeof nomeColaboradora !== 'string') {
      return res.status(400).json({
        error: 'Campo "nomeColaboradora", quando enviado, deve ser uma string ou null.',
      });
    }
    const trimmed = typeof nomeColaboradora === 'string' ? nomeColaboradora.trim() : '';
    nomeColaboradoraValue = trimmed.length > 0 ? trimmed : null;
  }

  try {
    const resultado = await numerosRemetentesService.atualizarNumero(idNum, {
      apelido: apelido !== undefined ? apelido.trim() : undefined,
      estadoId: estadoIdValue,
      ativo,
      nomeColaboradora: nomeColaboradoraValue,
    });

    if (resultado === null) {
      return res.status(404).json({ error: 'Número remetente não encontrado.' });
    }

    if (resultado === 'estado_inexistente') {
      return res.status(400).json({ error: 'Estado informado não existe.' });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao atualizar número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar número remetente.' });
  }
}

async function excluir(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  try {
    const resultado = await numerosRemetentesService.excluirNumero(idNum);

    if (resultado === 'not_found') {
      return res.status(404).json({ error: 'Número remetente não encontrado.' });
    }

    if (resultado === 'has_vinculos') {
      return res.status(409).json({
        error:
          'Não é possível excluir este número pois existem contatos ou importações vinculadas a ele. Utilize a atualização (PUT) com ativo=false para desativá-lo.',
      });
    }

    return res.status(204).send();
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao excluir número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir número remetente.' });
  }
}

/**
 * GET /numeros-remetentes/:id/conexao/stream (SSE)
 *
 * Abre (ou reaproveita) a sessão Baileys daquele número remetente e
 * transmite os eventos de conexão em tempo real:
 *   - `event: qr`          `data: { "qr": "<string crua>" }`
 *   - `event: conectado`   `data: { "numero": "5598..." }`
 *   - `event: erro`        `data: { "mensagem": "..." }`
 *   - `event: ja_conectado` `data: { "numero": "5598..." }` — emitido (e o
 *     stream encerrado em seguida) quando o número já está `'conectado'` no
 *     banco; nesse caso nenhuma sessão/QR novo é aberta.
 *
 * Múltiplas requisições simultâneas para o mesmo `:id` (ex.: duas abas)
 * reaproveitam a mesma sessão Baileys em memória — cada uma vira um listener
 * separado que recebe os mesmos eventos (ver `baileysSession.service.js`).
 */
async function conexaoStream(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  let numeroRemetente;
  try {
    numeroRemetente = await numerosRemetentesService.obterNumeroPorId(idNum);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao buscar número remetente para conexão:', err);
    return res.status(500).json({ error: 'Erro interno ao abrir conexão com o WhatsApp.' });
  }

  if (!numeroRemetente) {
    return res.status(404).json({ error: 'Número remetente não encontrado.' });
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const enviarEvento = (evento, data) => {
    res.write(`event: ${evento}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (numeroRemetente.statusConexao === 'conectado') {
    enviarEvento('ja_conectado', { numero: numeroRemetente.numero });
    return res.end();
  }

  let finalizado = false;
  const finalizar = () => {
    if (finalizado) return;
    finalizado = true;
    baileysSessionService.removerListener(idNum, listener);
    res.end();
  };

  const listener = {
    onQr: (qr) => enviarEvento('qr', { qr }),
    onConectado: (numero) => {
      enviarEvento('conectado', { numero });
      finalizar();
    },
    onErro: (mensagem) => {
      enviarEvento('erro', { mensagem });
      finalizar();
    },
  };

  // Aba fechada / cliente desconectou antes do QR ser escaneado: remove só
  // este listener, sem necessariamente encerrar a sessão Baileys em memória
  // (outra aba pode continuar esperando o mesmo QR).
  req.on('close', finalizar);

  try {
    await baileysSessionService.abrirConexao(idNum, listener);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao abrir conexão Baileys:', err);
    enviarEvento('erro', { mensagem: 'Erro interno ao abrir conexão com o WhatsApp.' });
    finalizar();
  }
}

/**
 * POST /numeros-remetentes/:id/conexao/desconectar
 *
 * Encerra a sessão Baileys daquele número (logout + remoção da pasta de
 * sessão em disco) e grava `numero = NULL` / `status_conexao =
 * 'aguardando_conexao'` no banco.
 */
async function conexaoDesconectar(req, res) {
  const idNum = Number(req.params.id);
  if (!isPositiveInteger(idNum)) {
    return res.status(400).json({ error: 'Parâmetro "id" deve ser um número inteiro positivo.' });
  }

  try {
    const numeroExistente = await numerosRemetentesService.obterNumeroPorId(idNum);
    if (!numeroExistente) {
      return res.status(404).json({ error: 'Número remetente não encontrado.' });
    }

    await baileysSessionService.desconectar(idNum);
    const atualizado = await numerosRemetentesService.marcarDesconectado(idNum);

    return res.status(200).json(atualizado);
  } catch (err) {
    console.error('[numerosRemetentes.controller] Erro ao desconectar número remetente:', err);
    return res.status(500).json({ error: 'Erro interno ao desconectar número remetente.' });
  }
}

module.exports = {
  listar,
  criar,
  atualizar,
  excluir,
  conexaoStream,
  conexaoDesconectar,
};
