const { sql, getPool } = require('../config/db');

function isViolacaoDeUnique(err) {
  return err && (err.number === 2627 || err.number === 2601);
}

async function inserirMensagemRecebida({ contatoId, numeroRemetenteId, corpo, baileysMessageId, ePrimeiraRespostaCliente, remetente = 'cliente', statusEntrega = null }) {
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
      .input('statusEntrega', sql.VarChar(20), statusEntrega)
      .query(`
        INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, status_entrega, lida, e_primeira_resposta_cliente, criado_em)
        OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.criado_em, inserted.e_primeira_resposta_cliente
        VALUES (@contatoId, @numeroRemetenteId, @remetente, @corpo, @baileysMessageId, @statusEntrega, 0, @ePrimeiraRespostaCliente, SYSUTCDATETIME())
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

async function inserirMensagemEnviada({ contatoId, numeroRemetenteId, remetente, corpo, baileysMessageId = null, statusEntrega = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .input('remetente', sql.VarChar(20), remetente)
    .input('corpo', sql.NVarChar(sql.MAX), corpo)
    .input('baileysMessageId', sql.VarChar(100), baileysMessageId)
    .input('statusEntrega', sql.VarChar(20), statusEntrega)
    .query(`
      INSERT INTO Mensagens (contato_id, numero_remetente_id, remetente, corpo, baileys_message_id, status_entrega, criado_em)
      OUTPUT inserted.id, inserted.remetente, inserted.corpo, inserted.baileys_message_id, inserted.status_entrega, inserted.criado_em
      VALUES (@contatoId, @numeroRemetenteId, @remetente, @corpo, @baileysMessageId, @statusEntrega, SYSUTCDATETIME())
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


async function listConversas({ busca, apenasNaoLidas, numeroRemetenteId, status } = {}) {
  const pool = await getPool();
  const request = pool.request();

  let whereBusca = '';
  if (busca) {
    request.input('busca', sql.NVarChar, `%${busca}%`);
    whereBusca = 'AND (c.nome LIKE @busca OR c.telefone LIKE @busca)';
  }

  let whereNumeroRemetente = '';
  if (numeroRemetenteId) {
    request.input('numeroRemetenteId', sql.Int, numeroRemetenteId);
    whereNumeroRemetente = 'AND m.numero_remetente_id = @numeroRemetenteId';
  }

  let havingNaoLidas = '';
  if (apenasNaoLidas) {
    havingNaoLidas = `
      HAVING SUM(CASE WHEN m.remetente = 'cliente' AND m.lida = 0 THEN 1 ELSE 0 END) > 0
    `;
  }

  let whereStatus = '';
  if (status) {
    request.input('status', sql.VarChar(20), status);
    whereStatus = 'WHERE cs.status = @status';
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
      ${whereNumeroRemetente}
      GROUP BY c.id, c.nome, c.telefone, m.numero_remetente_id, n.apelido
      ${havingNaoLidas}
    )
    SELECT tb.*, ultima.corpo AS ultima_corpo, ultima.remetente AS ultima_remetente, cs.status
    FROM ThreadsBase tb
    CROSS APPLY (
      SELECT TOP (1) corpo, remetente
      FROM Mensagens m2
      WHERE m2.contato_id = tb.contato_id AND m2.numero_remetente_id = tb.numero_remetente_id
      ORDER BY m2.id DESC
    ) ultima
    LEFT JOIN ConversasStatus cs ON cs.contato_id = tb.contato_id AND cs.numero_remetente_id = tb.numero_remetente_id
    ${whereStatus}
    ORDER BY tb.ultima_mensagem_em DESC
  `);

  return result.recordset.map((row) => ({
    contato: { id: row.contato_id, nome: row.contato_nome, telefone: row.contato_telefone },
    numeroRemetenteAtual: { id: row.numero_remetente_id, apelido: row.numero_remetente_apelido },
    numeroRemetenteInicial: { id: row.numero_remetente_id, apelido: row.numero_remetente_apelido },
    ultimaMensagem: { corpo: row.ultima_corpo, remetente: row.ultima_remetente, criado_em: row.ultima_mensagem_em },
    naoLidas: row.nao_lidas || 0,
    status: row.status ?? null,
  }));
}

async function listMensagensEMarcarLidas(contatoId, numeroRemetenteId) {
  const pool = await getPool();

  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT id, remetente, corpo, criado_em, baileys_message_id, status_entrega
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

async function atualizarStatusEntrega(baileysMessageId, novoStatus) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('baileysMessageId', sql.VarChar(100), baileysMessageId)
    .input('novoStatus', sql.VarChar(20), novoStatus)
    .query(`
      UPDATE Mensagens
      SET status_entrega = @novoStatus
      OUTPUT inserted.contato_id, inserted.numero_remetente_id, inserted.status_entrega
      WHERE baileys_message_id = @baileysMessageId
        AND (
          CASE status_entrega
            WHEN 'pendente' THEN 0 WHEN 'enviado' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lido' THEN 3 WHEN 'erro' THEN 4 ELSE -1
          END
        ) < (
          CASE @novoStatus
            WHEN 'pendente' THEN 0 WHEN 'enviado' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lido' THEN 3 WHEN 'erro' THEN 4 ELSE -1
          END
        )
    `);
  return result.recordset[0] ?? null;
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

async function registrarHistoricoStatus(contatoId, numeroRemetenteId, statusAnterior, statusNovo, origem, motivo = null, motivoDetalhe = null) {
  const pool = await getPool();
  await pool.request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .input('statusAnterior', sql.VarChar(20), statusAnterior ?? null)
    .input('statusNovo', sql.VarChar(20), statusNovo)
    .input('origem', sql.VarChar(20), origem)
    .input('motivo', sql.VarChar(30), motivo ?? null)
    .input('motivoDetalhe', sql.NVarChar(255), motivoDetalhe ?? null)
    .query(`
      INSERT INTO StatusHistorico (contato_id, numero_remetente_id, status_anterior, status_novo, origem, motivo, motivo_detalhe, alterado_em)
      VALUES (@contatoId, @numeroRemetenteId, @statusAnterior, @statusNovo, @origem, @motivo, @motivoDetalhe, SYSUTCDATETIME());
    `);
}

async function upsertStatusConversa(contatoId, numeroRemetenteId, status, motivo = null, motivoDetalhe = null) {
  const pool = await getPool();

  const statusAtualResult = await pool.request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT status
      FROM ConversasStatus
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId
    `);
  const statusAnterior = statusAtualResult.recordset[0]?.status ?? null;

  await pool.request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .input('status', sql.VarChar(20), status)
    .query(`
      MERGE ConversasStatus AS alvo
      USING (SELECT @contatoId AS contato_id, @numeroRemetenteId AS numero_remetente_id) AS origem
      ON alvo.contato_id = origem.contato_id AND alvo.numero_remetente_id = origem.numero_remetente_id
      WHEN MATCHED THEN UPDATE SET status = @status, atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (contato_id, numero_remetente_id, status, atualizado_em)
        VALUES (@contatoId, @numeroRemetenteId, @status, SYSUTCDATETIME());
    `);

  await registrarHistoricoStatus(contatoId, numeroRemetenteId, statusAnterior, status, 'atendente', motivo, motivoDetalhe);
}

async function marcarAtendeuSeVazio(contatoId, numeroRemetenteId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM ConversasStatus WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId)
      BEGIN
        INSERT INTO ConversasStatus (contato_id, numero_remetente_id, status, atualizado_em)
        OUTPUT inserted.id
        VALUES (@contatoId, @numeroRemetenteId, 'atendeu', SYSUTCDATETIME());
      END
    `);

  if (result.recordset.length > 0) {
    await registrarHistoricoStatus(contatoId, numeroRemetenteId, null, 'atendeu', 'sistema');
  }
}

async function listPipeline({ busca, numeroRemetenteId, statusInicio, statusFim, disparoInicio, disparoFim } = {}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('busca', sql.NVarChar, busca ? `%${busca}%` : null)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId ?? null)
    .input('statusInicio', sql.Date, statusInicio ?? null)
    .input('statusFim', sql.Date, statusFim ?? null)
    .input('disparoInicio', sql.Date, disparoInicio ?? null)
    .input('disparoFim', sql.Date, disparoFim ?? null)
    .query(`
      SELECT c.id AS contato_id, c.nome, c.telefone, n.id AS numero_remetente_id, n.apelido, cs.status, cs.atualizado_em,
        ultimoMotivo.motivo, ultimoMotivo.motivo_detalhe
      FROM ConversasStatus cs
      JOIN Contatos c ON c.id = cs.contato_id
      JOIN NumerosRemetentes n ON n.id = cs.numero_remetente_id
      OUTER APPLY (
        SELECT TOP 1 motivo, motivo_detalhe
        FROM StatusHistorico sh2
        WHERE sh2.contato_id = cs.contato_id AND sh2.numero_remetente_id = cs.numero_remetente_id AND sh2.status_novo = 'perdido'
        ORDER BY sh2.alterado_em DESC
      ) ultimoMotivo
      WHERE cs.status IS NOT NULL
        AND (@busca IS NULL OR c.nome LIKE @busca)
        AND (@numeroRemetenteId IS NULL OR cs.numero_remetente_id = @numeroRemetenteId)
        AND (@statusInicio IS NULL OR cs.atualizado_em >= @statusInicio)
        AND (@statusFim IS NULL OR cs.atualizado_em < DATEADD(day, 1, @statusFim))
        AND (
          (@disparoInicio IS NULL AND @disparoFim IS NULL)
          OR EXISTS (
            SELECT 1 FROM DisparoContatos dc
            JOIN Disparos d ON d.id = dc.disparo_id
            WHERE dc.contato_id = c.id
              AND (@disparoInicio IS NULL OR d.criado_em >= @disparoInicio)
              AND (@disparoFim IS NULL OR d.criado_em < DATEADD(day, 1, @disparoFim))
          )
        )
      ORDER BY cs.atualizado_em DESC
    `);
  return result.recordset.map((row) => {
    const { motivo_detalhe, ...resto } = row;
    return { ...resto, motivoDetalhe: motivo_detalhe };
  });
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

async function listHistoricoStatus(contatoId, numeroRemetenteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('contatoId', sql.Int, contatoId)
    .input('numeroRemetenteId', sql.Int, numeroRemetenteId)
    .query(`
      SELECT status_anterior, status_novo, origem, alterado_em
      FROM StatusHistorico
      WHERE contato_id = @contatoId AND numero_remetente_id = @numeroRemetenteId
      ORDER BY alterado_em DESC
    `);
  return result.recordset;
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
  atualizarStatusEntrega,
  findUltimoNumeroRemetenteDaConversa,
  findPrimeiroNumeroRemetenteDaConversa,
  upsertStatusConversa,
  marcarAtendeuSeVazio,
  registrarHistoricoStatus,
  listPipeline,
  listHistoricoStatus,
};
