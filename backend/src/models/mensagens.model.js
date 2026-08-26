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

async function existeMensagemClienteAnterior(contatoId, numeroRemetenteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT TOP (1) 1 AS ok
      FROM Mensagens
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId AND remetente = 'cliente'
    `);
  return result.recordset.length > 0;
}

async function existeMensagemNaThread(contatoId, numeroRemetenteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT TOP (1) 1 AS ok
      FROM Mensagens
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId
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
        m.numero_remetente_id,
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
    numeroRemetenteId: row.numero_remetente_id,
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
    ;WITH ThreadsBase AS (
      SELECT
        c.id AS contato_id,
        c.nome AS contato_nome,
        c.telefone AS contato_telefone,
        m.numero_remetente_id,
        n.apelido AS numero_remetente_apelido,
        MAX(m.criado_em) AS ultima_mensagem_em,
        SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) AS nao_lidas
      FROM Mensagens m
      JOIN Contatos c ON c.id = m.contato_id
      JOIN NumerosRemetentes n ON n.id = m.numero_remetente_id
      WHERE 1 = 1
      ${whereBusca}
      GROUP BY c.id, c.nome, c.telefone, m.numero_remetente_id, n.apelido
      ${havingNaoLidas}
    )
    SELECT tb.*, ultima.corpo AS ultima_corpo, ultima.remetente AS ultima_remetente
    FROM ThreadsBase tb
    CROSS APPLY (
      SELECT TOP (1) corpo, remetente
      FROM Mensagens m2
      WHERE m2.contato_id = tb.contato_id AND m2.numero_remetente_id = tb.numero_remetente_id
      ORDER BY m2.id DESC
    ) ultima
    ORDER BY tb.ultima_mensagem_em DESC
  `);

  return result.recordset.map((row) => ({
    contato: { id: row.contato_id, nome: row.contato_nome, telefone: row.contato_telefone },
    numeroRemetenteAtual: { id: row.numero_remetente_id, apelido: row.numero_remetente_apelido },
    numeroRemetenteInicial: { id: row.numero_remetente_id, apelido: row.numero_remetente_apelido },
    ultimaMensagem: { corpo: row.ultima_corpo, remetente: row.ultima_remetente, criado_em: row.ultima_mensagem_em },
    naoLidas: row.nao_lidas || 0,
  }));
}

async function listMensagensEMarcarLidas(contatoId, numeroRemetenteId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT id, remetente, corpo, criado_em
      FROM Mensagens
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId
      ORDER BY criado_em ASC
    `);

  await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      UPDATE Mensagens
      SET lida = 1
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId AND remetente = 'cliente' AND lida = 0
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
  existeMensagemNaThread,
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
