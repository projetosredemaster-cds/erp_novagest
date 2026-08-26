const { sql, getPool } = require('../config/db');

function isViolacaoDeUnique(err) {
  return err && (err.number === 2627 || err.number === 2601);
}

async function inserirMensagemRecebida({ contatoId, numeroRemetenteId, corpo, baileysMessageId, ePrimeiraRespostaCliente, remetente = 'cliente' }) {
  const pool = await getPool();

  try {
    const result = await pool
      .request()
      .input('contatoId', sql.Int, contatoId)
      .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
      .input('corpo', sql.NVarChar(sql.MAX), corpo)
      .input('baileysMessageId', sql.VarChar(100), baileysMessageId ?? null)
      .input('ePrimeiraRespostaCliente', sql.Bit, Boolean(ePrimeiraRespostaCliente))
      .input('remetente', sql.VarChar(20), remetente)
      .query(`
        INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, lida, e_primeira_resposta_cliente, criado_em)
        OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.criado_em, inserted.e_primeira_resposta_cliente
        VALUES (@contatoId, @numeroRemetenteId, @remetente, @corpo, @baileysMessageId, 0, @ePrimeiraRespostaCliente, SYSUTCDATETIME())
      `);
    return result.recordset[0];
  } catch (err) {
    if (isViolacaoDeUnique(err)) {
      console.log(
        `[mensagens.model] mensagem duplicada ignorada (dedup) — numeroRemetenteId=${numeroRemetenteId}, ` +
        `baileysMessageId=${baileysMessageId}.`
      );
      return null;
    }
    throw err;
  }
}

async function existeMensagemClienteAnterior(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) 1 AS ok
      FROM Mensagens
      WHERE contato_id = @contatoId AND remetente = 'cliente'
    `);
  return result.recordset.length > 0;
}

async function contarNotificacoesNaoVistas() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`
      SELECT COUNT(*) AS total
      FROM Mensagens
      WHERE e_primeira_resposta_cliente = 1 AND lida = 0
    `);
  return result.recordset[0]?.total ?? 0;
}

function truncarTexto(texto, tamanho) {
  if (typeof texto !== 'string' || texto.length <= tamanho) {
    return texto;
  }
  return `${texto.slice(0, tamanho)}…`;
}

async function listNotificacoesPendentes(limite = 10) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('limite', sql.Int, limite)
    .query(`
      SELECT TOP (@limite)
        m.contato_id,
        c.nome,
        c.telefone,
        m.corpo,
        m.criado_em
      FROM Mensagens m
      JOIN Contatos c ON c.id = m.contato_id
      WHERE m.e_primeira_resposta_cliente = 1 AND m.lida = 0
      ORDER BY m.criado_em DESC
    `);

  return result.recordset.map((row) => ({
    contatoId: row.contato_id,
    nomeContato: row.nome,
    telefone: row.telefone,
    preview: truncarTexto(row.corpo, 80),
    criado_em: row.criado_em,
  }));
}

async function inserirMensagemEnviada({ contatoId, numeroRemetenteId, remetente, corpo }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .input('remetente', sql.VarChar(20), remetente)
    .input('corpo', sql.NVarChar(sql.MAX), corpo)
    .query(`
      INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, criado_em)
      OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.criado_em
      VALUES (@contatoId, @numeroRemetenteId, @remetente, @corpo, NULL, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}

async function findContatoIdPorTelefoneComVariantes(telefones) {
  const candidatos = Array.isArray(telefones) ? telefones.filter(Boolean) : [];
  if (candidatos.length === 0) {
    return null;
  }

  const pool = await getPool();
  const request = pool.request();
  const placeholders = candidatos.map((telefone, index) => {
    const paramName = `telefone${index}`;
    request.input(paramName, sql.VarChar(20), telefone);
    return `@${paramName}`;
  });

  const result = await request.query(
    `SELECT TOP (1) id FROM Contatos WHERE telefone IN (${placeholders.join(', ')})`
  );
  return result.recordset[0]?.id ?? null;
}

async function existeContato(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query('SELECT 1 AS ok FROM Contatos WHERE id = @contatoId');
  return result.recordset.length > 0;
}

async function findTelefoneContato(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query('SELECT telefone FROM Contatos WHERE id = @contatoId');
  return result.recordset[0]?.telefone ?? null;
}


async function listConversas({ busca, apenasNaoLidas } = {}) {
  const pool = await getPool();
  const request = pool.request();

  let whereBusca = '';
  if (busca) {
    request.input('busca', sql.NVarChar, `%${busca}%`);
    whereBusca = 'AND (c.nome LIKE @busca OR c.telefone LIKE @busca)';
  }

  let havingNaoLidas = '';
  if (apenasNaoLidas) {
    havingNaoLidas = `
      HAVING SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) > 0
    `;
  }

  const result = await request.query(`
    SELECT
      c.id AS contato_id,
      c.nome AS contato_nome,
      c.telefone AS contato_telefone,
      MAX(m.criado_em) AS ultima_mensagem_em,
      SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) AS nao_lidas
    FROM Mensagens m
    JOIN Contatos c ON c.id = m.contato_id
    WHERE 1 = 1
    ${whereBusca}
    GROUP BY c.id, c.nome, c.telefone
    ${havingNaoLidas}
    ORDER BY MAX(m.criado_em) DESC
  `);

  const conversas = result.recordset;
  if (conversas.length === 0) {
    return [];
  }

  const contatoIds = conversas.map((row) => row.contato_id);
  const idsRequest = pool.request();
  const placeholders = contatoIds.map((id, index) => {
    const paramName = `id${index}`;
    idsRequest.input(paramName, sql.Int, id);
    return `@${paramName}`;
  });

  const ultimasResult = await idsRequest.query(`
    SELECT m.contato_id, m.remetente, m.corpo, m.criado_em, m.numero_remetente_id, n.apelido
    FROM Mensagens m
    INNER JOIN (
      SELECT contato_id, MAX(id) AS ultimo_id
      FROM Mensagens
      WHERE contato_id IN (${placeholders.join(', ')})
      GROUP BY contato_id
    ) ultimas ON ultimas.ultimo_id = m.id
    JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
  `);

  const ultimaPorContato = new Map(ultimasResult.recordset.map((row) => [row.contato_id, row]));
  const primeirasRequest = pool.request();
  const placeholdersPrimeiras = contatoIds.map((id, index) => {
    const paramName = `pid${index}`;
    primeirasRequest.input(paramName, sql.Int, id);
    return `@${paramName}`;
  });

  const primeirasResult = await primeirasRequest.query(`
    SELECT m.contato_id, m.numero_remetente_id, n.apelido
    FROM Mensagens m
    INNER JOIN (
      SELECT contato_id, MIN(id) AS primeiro_id
      FROM Mensagens
      WHERE contato_id IN (${placeholdersPrimeiras.join(', ')})
      GROUP BY contato_id
    ) primeiras ON primeiras.primeiro_id = m.id
    JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
  `);

  const primeiraPorContato = new Map(primeirasResult.recordset.map((row) => [row.contato_id, row]));

  return conversas.map((row) => {
    const ultima = ultimaPorContato.get(row.contato_id);
    const primeira = primeiraPorContato.get(row.contato_id);
    return {
      contato: { id: row.contato_id, nome: row.contato_nome, telefone: row.contato_telefone },
      numeroRemetenteAtual: ultima ? { id: ultima.numero_remetente_id, apelido: ultima.apelido } : null,
      numeroRemetenteInicial: primeira ? { id: primeira.numero_remetente_id, apelido: primeira.apelido } : null,
      ultimaMensagem: ultima
        ? { corpo: ultima.corpo, remetente: ultima.remetente, criado_em: ultima.criado_em }
        : null,
      naoLidas: row.nao_lidas || 0,
    };
  });
}

async function listMensagensEMarcarLidas(contatoId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT id, remetente, corpo, criado_em
      FROM Mensagens
      WHERE contato_id = @contatoId
      ORDER BY criado_em ASC
    `);

  await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      UPDATE Mensagens
      SET lida = 1
      WHERE contato_id = @contatoId AND remetente = 'cliente' AND lida = 0
    `);

  return result.recordset;
}

async function findUltimoNumeroRemetenteDaConversa(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) numero_remetente_id
      FROM Mensagens
      WHERE contato_id = @contatoId
      ORDER BY criado_em DESC, id DESC
    `);
  return result.recordset[0]?.numero_remetente_id ?? null;
}

async function findPrimeiroNumeroRemetenteDaConversa(contatoId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .query(`
      SELECT TOP (1) m.numero_remetente_id, n.apelido
      FROM Mensagens m
      JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
      WHERE m.contato_id = @contatoId
      ORDER BY m.criado_em ASC, m.id ASC
    `);

  const row = result.recordset[0];
  return row ? { id: row.numero_remetente_id, apelido: row.apelido } : null;
}

module.exports = {
  inserirMensagemRecebida,
  existeMensagemClienteAnterior,
  contarNotificacoesNaoVistas,
  listNotificacoesPendentes,
  inserirMensagemEnviada,
  findContatoIdPorTelefoneComVariantes,
  existeContato,
  findTelefoneContato,
  listConversas,
  listMensagensEMarcarLidas,
  findUltimoNumeroRemetenteDaConversa,
  findPrimeiroNumeroRemetenteDaConversa,
};
