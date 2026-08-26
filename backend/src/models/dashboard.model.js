const { sql, getPool } = require('../config/db');

const FILTRO_ESTADO = '(@estadoId IS NULL OR d.estado_id = @estadoId)';

function novoRequestComEstado(pool, estadoId) {
  return pool.request().input('estadoId', sql.Int, estadoId ?? null);
}

async function getTotalDisparos(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    WHERE ${FILTRO_ESTADO}
  `);

  return result.recordset[0]?.total ?? 0;
}

async function getTaxas(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT
      ROUND(COUNT(CASE WHEN cs.status = 'atendeu' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS atendeu,
      ROUND(COUNT(CASE WHEN cs.status = 'agendou' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS agendou,
      ROUND(COUNT(CASE WHEN cs.status = 'nao_atendeu' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS nao_atendeu,
      ROUND(COUNT(CASE WHEN cs.status = 'venda' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS venda,
      ROUND(COUNT(CASE WHEN cs.status = 'perdido' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS perdido
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    LEFT JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO}
  `);

  const linha = result.recordset[0] || {};

  return {
    atendeu: linha.atendeu ?? 0,
    agendou: linha.agendou ?? 0,
    nao_atendeu: linha.nao_atendeu ?? 0,
    venda: linha.venda ?? 0,
    perdido: linha.perdido ?? 0,
  };
}

async function getDisparosPorRegiao(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT d.estado_id, e.nome, e.uf, COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    JOIN Estados e ON e.id = d.estado_id
    WHERE ${FILTRO_ESTADO}
    GROUP BY d.estado_id, e.nome, e.uf
    ORDER BY total DESC
  `);

  return result.recordset.map((row) => ({
    estadoId: row.estado_id,
    nome: row.nome,
    uf: row.uf,
    total: row.total,
  }));
}

async function getStatusGeral(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT cs.status, COUNT(*) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO} AND cs.status IS NOT NULL
    GROUP BY cs.status
  `);

  return result.recordset.map((row) => ({
    status: row.status,
    total: row.total,
  }));
}

async function getRankingAtendentes(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT
      n.id AS numero_remetente_id,
      n.apelido,
      COUNT(CASE WHEN cs.status = 'atendeu' THEN 1 END) AS atendeu,
      COUNT(CASE WHEN cs.status = 'agendou' THEN 1 END) AS agendou,
      COUNT(CASE WHEN cs.status = 'nao_atendeu' THEN 1 END) AS nao_atendeu,
      COUNT(CASE WHEN cs.status = 'venda' THEN 1 END) AS venda,
      COUNT(CASE WHEN cs.status = 'perdido' THEN 1 END) AS perdido,
      COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    JOIN NumerosRemetentes n ON n.id = d.numero_remetente_id
    LEFT JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO}
    GROUP BY n.id, n.apelido
    ORDER BY total DESC
  `);

  return result.recordset.map((row) => ({
    numeroRemetenteId: row.numero_remetente_id,
    apelido: row.apelido,
    atendeu: row.atendeu,
    agendou: row.agendou,
    nao_atendeu: row.nao_atendeu,
    venda: row.venda,
    perdido: row.perdido,
    total: row.total,
  }));
}

async function getFunilConversao(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT
      ROUND(
        COUNT(CASE WHEN cs.status = 'venda' THEN 1 END) * 100.0
        / NULLIF(COUNT(CASE WHEN cs.status IN ('atendeu','agendou','venda','perdido') THEN 1 END), 0)
      , 1) AS taxaConversaoEngajados
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    LEFT JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO}
  `);

  const linha = result.recordset[0] || {};

  return { taxaConversaoEngajados: linha.taxaConversaoEngajados ?? 0 };
}

async function getTendenciaDiaria(pool, estadoId) {
  const result = await novoRequestComEstado(pool, estadoId).query(`
    SELECT CONVERT(VARCHAR(10), CAST(d.criado_em AS DATE), 23) AS dia, COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    WHERE d.criado_em >= DATEADD(DAY, -30, SYSUTCDATETIME())
      AND ${FILTRO_ESTADO}
    GROUP BY CAST(d.criado_em AS DATE)
  `);

  const porDia = new Map(result.recordset.map((row) => [row.dia, row.total]));
  const dias = [];
  const hoje = new Date();
  for (let i = 29; i >= 0; i -= 1) {
    const data = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i));
    const chave = data.toISOString().slice(0, 10);
    dias.push({ dia: chave, total: porDia.get(chave) ?? 0 });
  }

  return dias;
}

async function getTaxasEmPeriodo(pool, estadoId, inicio, fimExclusivo) {
  const result = await pool.request()
    .input('estadoId', sql.Int, estadoId ?? null)
    .input('inicio', sql.DateTime2, inicio)
    .input('fim', sql.DateTime2, fimExclusivo)
    .query(`
      SELECT
        ROUND(COUNT(CASE WHEN cs.status = 'atendeu' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS atendeu,
        ROUND(COUNT(CASE WHEN cs.status = 'agendou' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS agendou,
        ROUND(COUNT(CASE WHEN cs.status = 'nao_atendeu' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS nao_atendeu,
        ROUND(COUNT(CASE WHEN cs.status = 'venda' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS venda,
        ROUND(COUNT(CASE WHEN cs.status = 'perdido' THEN 1 END) * 100.0 / NULLIF(COUNT(dc.id), 0), 1) AS perdido
      FROM DisparoContatos dc
      JOIN Disparos d ON dc.disparo_id = d.id
      LEFT JOIN ConversasStatus cs ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
      WHERE d.criado_em >= @inicio AND d.criado_em < @fim
        AND (@estadoId IS NULL OR d.estado_id = @estadoId)
    `);

  const linha = result.recordset[0] || {};

  return {
    atendeu: linha.atendeu ?? 0,
    agendou: linha.agendou ?? 0,
    nao_atendeu: linha.nao_atendeu ?? 0,
    venda: linha.venda ?? 0,
    perdido: linha.perdido ?? 0,
  };
}

async function getComparativoSemanal(pool, estadoId) {
  const agora = new Date();
  const seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const catorzeDiasAtras = new Date(agora.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [atual, anterior] = await Promise.all([
    getTaxasEmPeriodo(pool, estadoId, seteDiasAtras, agora),
    getTaxasEmPeriodo(pool, estadoId, catorzeDiasAtras, seteDiasAtras),
  ]);

  return { atual, anterior };
}

async function getDashboard(estadoId) {
  const pool = await getPool();

  const [
    totalDisparos,
    taxas,
    disparosPorRegiao,
    statusGeral,
    rankingAtendentes,
    funilConversao,
    tendenciaDiaria,
    comparativoSemanal,
  ] = await Promise.all([
    getTotalDisparos(pool, estadoId),
    getTaxas(pool, estadoId),
    getDisparosPorRegiao(pool, estadoId),
    getStatusGeral(pool, estadoId),
    getRankingAtendentes(pool, estadoId),
    getFunilConversao(pool, estadoId),
    getTendenciaDiaria(pool, estadoId),
    getComparativoSemanal(pool, estadoId),
  ]);

  return {
    totalDisparos,
    taxas,
    disparosPorRegiao,
    statusGeral,
    rankingAtendentes,
    funilConversao,
    tendenciaDiaria,
    comparativoSemanal,
  };
}

module.exports = {
  getDashboard,
};
