const { sql, getPool } = require('../config/db');

const ORDENACOES = {
  nome_asc: 'c.nome ASC',
  nome_desc: 'c.nome DESC',
  recentes: 'c.criado_em DESC',
};

/**
 * Painel de Disparo — todo Estado cadastrado, com seus números remetentes
 * ativos e a contagem de contatos vinculados. Inclui Estado sem número
 * ativo e/ou sem contato (numerosAtivos: [], totalContatos: 0) de propósito
 * — ver "Contexto e decisões de design" em CONTRATO-CONTROLE-LIGACOES-API.md
 * (seção Painel de Disparo v3): o frontend precisa distinguir "estado
 * vazio" de "estado inexistente".
 */
async function listPainelDisparo() {
  const pool = await getPool();

  const estadosResult = await pool
    .request()
    .query('SELECT id, nome, uf FROM Estados ORDER BY nome');

  const numerosResult = await pool.request().query(`
    SELECT id, estado_id, apelido, status_conexao
    FROM NumerosRemetentes
    WHERE ativo = 1
    ORDER BY apelido
  `);

  const contatosResult = await pool.request().query(`
    SELECT estado_id, COUNT(*) AS total
    FROM Contatos
    WHERE estado_id IS NOT NULL
    GROUP BY estado_id
  `);

  const numerosPorEstado = new Map();
  for (const row of numerosResult.recordset) {
    if (!numerosPorEstado.has(row.estado_id)) {
      numerosPorEstado.set(row.estado_id, []);
    }
    numerosPorEstado.get(row.estado_id).push({
      id: row.id,
      apelido: row.apelido,
      statusConexao: row.status_conexao,
    });
  }

  const totalPorEstado = new Map(
    contatosResult.recordset.map((row) => [row.estado_id, row.total])
  );

  return estadosResult.recordset.map((estado) => ({
    estado: { id: estado.id, nome: estado.nome, uf: estado.uf },
    totalContatos: totalPorEstado.get(estado.id) || 0,
    numerosAtivos: numerosPorEstado.get(estado.id) || [],
  }));
}

/**
 * Contatos de um Estado (NÃO filtra por numero_remetente_id — um contato
 * não fica travado ao número que o originou, ver decisão de design no
 * contrato). `disparadoUltimos3Dias` é sempre recalculado aqui a partir de
 * Disparos+DisparoContatos, nunca confiado do chamador.
 */
async function listContatosDisponiveis(estadoId, { busca, ordem } = {}) {
  const pool = await getPool();
  const request = pool.request();
  request.input('estadoId', sql.Int, estadoId);

  let whereBusca = '';
  if (busca) {
    request.input('busca', sql.NVarChar, `%${busca}%`);
    whereBusca = 'AND (c.nome LIKE @busca OR c.telefone LIKE @busca)';
  }

  const orderBy = ORDENACOES[ordem] || ORDENACOES.nome_asc;

  const result = await request.query(`
    SELECT
      c.id,
      c.nome,
      c.telefone,
      CASE WHEN EXISTS (
        SELECT 1
        FROM DisparoContatos dc
        JOIN Disparos d ON d.id = dc.disparo_id
        WHERE dc.contato_id = c.id
          AND d.criado_em >= DATEADD(day, -3, SYSUTCDATETIME())
      ) THEN 1 ELSE 0 END AS disparado_ultimos_3_dias
    FROM Contatos c
    WHERE c.estado_id = @estadoId
    ${whereBusca}
    ORDER BY ${orderBy}
  `);

  return result.recordset.map((row) => ({
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    disparadoUltimos3Dias: Boolean(row.disparado_ultimos_3_dias),
  }));
}

/**
 * Valida (numeroRemetenteId ativo e do estadoId informado; todo contatoId
 * pertence ao estadoId informado), recalcula disparadoUltimos3Dias por
 * contato (nunca confia no que o frontend mandou) e grava Disparos +
 * DisparoContatos numa única transação.
 *
 * Retorna:
 *   { status: 'numero_invalido' } |
 *   { status: 'contatos_invalidos' } |
 *   { status: 'criado', disparoId, totalContatos, avisos: [{id,nome,telefone}] }
 */
async function criarDisparo({ estadoId, numeroRemetenteId, usuarioId, contatoIds }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const numeroRequest = new sql.Request(transaction);
    numeroRequest.input('numeroId', sql.Int, numeroRemetenteId);
    const numeroResult = await numeroRequest.query(
      'SELECT id, estado_id, ativo FROM NumerosRemetentes WHERE id = @numeroId'
    );
    const numero = numeroResult.recordset[0];

    if (!numero || numero.estado_id !== estadoId || !numero.ativo) {
      await transaction.rollback();
      return { status: 'numero_invalido' };
    }

    const contatosRequest = new sql.Request(transaction);
    contatosRequest.input('estadoId', sql.Int, estadoId);
    const placeholders = contatoIds.map((contatoId, index) => {
      const paramName = `contato${index}`;
      contatosRequest.input(paramName, sql.Int, contatoId);
      return `@${paramName}`;
    });
    const contatosResult = await contatosRequest.query(`
      SELECT
        c.id,
        c.nome,
        c.telefone,
        CASE WHEN EXISTS (
          SELECT 1
          FROM DisparoContatos dc
          JOIN Disparos d ON d.id = dc.disparo_id
          WHERE dc.contato_id = c.id
            AND d.criado_em >= DATEADD(day, -3, SYSUTCDATETIME())
        ) THEN 1 ELSE 0 END AS disparado_ultimos_3_dias
      FROM Contatos c
      WHERE c.estado_id = @estadoId AND c.id IN (${placeholders.join(', ')})
    `);

    if (contatosResult.recordset.length !== contatoIds.length) {
      await transaction.rollback();
      return { status: 'contatos_invalidos' };
    }

    const avisos = contatosResult.recordset
      .filter((row) => row.disparado_ultimos_3_dias)
      .map((row) => ({ id: row.id, nome: row.nome, telefone: row.telefone }));

    const disparoRequest = new sql.Request(transaction);
    disparoRequest.input('estadoId', sql.Int, estadoId);
    disparoRequest.input('numeroId', sql.Int, numeroRemetenteId);
    disparoRequest.input('usuarioId', sql.Int, usuarioId);
    const disparoResult = await disparoRequest.query(`
      INSERT INTO Disparos (estado_id, numero_remetente_id, usuario_id, status, criado_em)
      OUTPUT inserted.id
      VALUES (@estadoId, @numeroId, @usuarioId, 'pendente_envio', SYSUTCDATETIME())
    `);
    const disparoId = disparoResult.recordset[0].id;

    for (const contatoId of contatoIds) {
      const contatoRequest = new sql.Request(transaction);
      contatoRequest.input('disparoId', sql.Int, disparoId);
      contatoRequest.input('contatoId', sql.Int, contatoId);
      await contatoRequest.query(`
        INSERT INTO DisparoContatos (disparo_id, contato_id)
        VALUES (@disparoId, @contatoId)
      `);
    }

    await transaction.commit();
    return {
      status: 'criado',
      disparoId,
      totalContatos: contatoIds.length,
      avisos,
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listPainelDisparo,
  listContatosDisponiveis,
  criarDisparo,
};
