const { sql, getPool } = require('../config/db');

const FILTRO_ESTADO = '(@estadoId IS NULL OR d.estado_id = @estadoId)';
const FILTRO_PERIODO = '(@dataInicio IS NULL OR d.criado_em >= @dataInicio) AND (@dataFim IS NULL OR d.criado_em < DATEADD(day, 1, @dataFim))';

function novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim } = {}) {
  return pool.request()
    .input('estadoId', sql.Int, estadoId ?? null)
    .input('dataInicio', sql.Date, dataInicio ?? null)
    .input('dataFim', sql.Date, dataFim ?? null);
}

async function getTotalDisparos(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO}
  `);

  return result.recordset[0]?.total ?? 0;
}

async function getTaxas(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
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
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO}
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

async function getDisparosPorRegiao(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT d.estado_id, e.nome, e.uf, COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    JOIN Estados e ON e.id = d.estado_id
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO}
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

async function getStatusGeral(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT cs.status, COUNT(*) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO} AND cs.status IS NOT NULL
    GROUP BY cs.status
  `);

  return result.recordset.map((row) => ({
    status: row.status,
    total: row.total,
  }));
}

async function getRankingAtendentes(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
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
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO}
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

async function getFunilConversao(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT
      ROUND(
        COUNT(CASE WHEN cs.status = 'venda' THEN 1 END) * 100.0
        / NULLIF(COUNT(CASE WHEN cs.status IN ('atendeu','agendou','venda','perdido') THEN 1 END), 0)
      , 1) AS taxaConversaoEngajados
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    LEFT JOIN ConversasStatus cs
      ON cs.contato_id = dc.contato_id AND cs.numero_remetente_id = d.numero_remetente_id
    WHERE ${FILTRO_ESTADO} AND ${FILTRO_PERIODO}
  `);

  const linha = result.recordset[0] || {};

  return { taxaConversaoEngajados: linha.taxaConversaoEngajados ?? 0 };
}

async function getTendenciaDiaria(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT CONVERT(VARCHAR(10), CAST(d.criado_em AS DATE), 23) AS dia, COUNT(dc.id) AS total
    FROM DisparoContatos dc
    JOIN Disparos d ON dc.disparo_id = d.id
    WHERE d.criado_em >= DATEADD(DAY, -30, SYSUTCDATETIME())
      AND ${FILTRO_ESTADO}
      AND ${FILTRO_PERIODO}
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

async function getTaxasEmPeriodo(pool, { estadoId, dataInicio, dataFim, inicio, fimExclusivo } = {}) {
  const result = await pool.request()
    .input('estadoId', sql.Int, estadoId ?? null)
    .input('dataInicio', sql.Date, dataInicio ?? null)
    .input('dataFim', sql.Date, dataFim ?? null)
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
        AND ${FILTRO_PERIODO}
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

async function getComparativoSemanal(pool, { estadoId, dataInicio, dataFim } = {}) {
  const agora = new Date();
  const seteDiasAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const catorzeDiasAtras = new Date(agora.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [atual, anterior] = await Promise.all([
    getTaxasEmPeriodo(pool, { estadoId, dataInicio, dataFim, inicio: seteDiasAtras, fimExclusivo: agora }),
    getTaxasEmPeriodo(pool, { estadoId, dataInicio, dataFim, inicio: catorzeDiasAtras, fimExclusivo: seteDiasAtras }),
  ]);

  return { atual, anterior };
}

async function getTempoMedioPorEtapa(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    WITH Periodos AS (
      SELECT sh.status_novo, sh.alterado_em,
             DATEDIFF(MINUTE, sh.alterado_em, LEAD(sh.alterado_em) OVER (PARTITION BY sh.contato_id, sh.numero_remetente_id ORDER BY sh.alterado_em)) AS minutos
      FROM StatusHistorico sh
      JOIN Contatos c ON c.id = sh.contato_id
      WHERE (@estadoId IS NULL OR c.estado_id = @estadoId)
    )
    SELECT status_novo, ROUND(AVG(minutos) / 60.0, 1) AS horasMedias
    FROM Periodos
    WHERE minutos IS NOT NULL
      AND (@dataInicio IS NULL OR alterado_em >= @dataInicio)
      AND (@dataFim IS NULL OR alterado_em < DATEADD(day, 1, @dataFim))
    GROUP BY status_novo
  `);

  return result.recordset.map((row) => ({ status: row.status_novo, horasMedias: row.horasMedias }));
}

async function getTempoMedioConversao(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    WITH Atendeu AS (
      SELECT contato_id, numero_remetente_id, MIN(alterado_em) AS dataAtendeu
      FROM StatusHistorico WHERE status_novo = 'atendeu' GROUP BY contato_id, numero_remetente_id
    ), Venda AS (
      SELECT contato_id, numero_remetente_id, MIN(alterado_em) AS dataVenda
      FROM StatusHistorico WHERE status_novo = 'venda' GROUP BY contato_id, numero_remetente_id
    )
    SELECT ROUND(AVG(DATEDIFF(MINUTE, a.dataAtendeu, v.dataVenda)) / 60.0, 1) AS horasMedias
    FROM Atendeu a
    JOIN Venda v ON v.contato_id = a.contato_id AND v.numero_remetente_id = a.numero_remetente_id
    JOIN Contatos c ON c.id = a.contato_id
    WHERE (@estadoId IS NULL OR c.estado_id = @estadoId)
      AND (@dataInicio IS NULL OR v.dataVenda >= @dataInicio)
      AND (@dataFim IS NULL OR v.dataVenda < DATEADD(day, 1, @dataFim))
  `);

  return { horasMedias: result.recordset[0]?.horasMedias ?? null };
}

async function getVelocidadeRespostaAtendente(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    WITH PrimeiraAcao AS (
      SELECT contato_id, numero_remetente_id, MIN(alterado_em) AS dataAcao
      FROM StatusHistorico WHERE origem = 'atendente' GROUP BY contato_id, numero_remetente_id
    )
    SELECT n.apelido, ROUND(AVG(DATEDIFF(MINUTE, ultimoDisparo.criado_em, pa.dataAcao)) / 60.0, 1) AS horasMedias
    FROM PrimeiraAcao pa
    JOIN Contatos c ON c.id = pa.contato_id
    JOIN NumerosRemetentes n ON n.id = pa.numero_remetente_id
    CROSS APPLY (
      SELECT TOP (1) d.criado_em
      FROM DisparoContatos dc
      JOIN Disparos d ON d.id = dc.disparo_id
      WHERE dc.contato_id = pa.contato_id
        AND d.numero_remetente_id = pa.numero_remetente_id
        AND d.criado_em <= pa.dataAcao
      ORDER BY d.criado_em DESC
    ) ultimoDisparo
    WHERE (@estadoId IS NULL OR c.estado_id = @estadoId)
      AND (@dataInicio IS NULL OR pa.dataAcao >= @dataInicio)
      AND (@dataFim IS NULL OR pa.dataAcao < DATEADD(day, 1, @dataFim))
    GROUP BY n.apelido
  `);

  return result.recordset.map((row) => ({ apelido: row.apelido, horasMedias: row.horasMedias }));
}

async function getTaxaRecuo(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    WITH JaAgendou AS (
      SELECT DISTINCT sh.contato_id, sh.numero_remetente_id
      FROM StatusHistorico sh
      JOIN Contatos c ON c.id = sh.contato_id
      WHERE sh.status_novo = 'agendou'
        AND (@estadoId IS NULL OR c.estado_id = @estadoId)
        AND (@dataInicio IS NULL OR sh.alterado_em >= @dataInicio)
        AND (@dataFim IS NULL OR sh.alterado_em < DATEADD(day, 1, @dataFim))
    )
    SELECT ROUND(COUNT(CASE WHEN cs.status = 'perdido' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS taxaPct
    FROM JaAgendou ja
    JOIN ConversasStatus cs ON cs.contato_id = ja.contato_id AND cs.numero_remetente_id = ja.numero_remetente_id
  `);

  return { taxaPct: result.recordset[0]?.taxaPct ?? null };
}

async function getCaminhosComuns(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    WITH Caminho AS (
      SELECT sh.contato_id, sh.numero_remetente_id,
             STRING_AGG(sh.status_novo, ' → ') WITHIN GROUP (ORDER BY sh.alterado_em) AS caminho,
             MAX(sh.alterado_em) AS ultimaMudanca
      FROM StatusHistorico sh
      JOIN Contatos c ON c.id = sh.contato_id
      WHERE (@estadoId IS NULL OR c.estado_id = @estadoId)
      GROUP BY sh.contato_id, sh.numero_remetente_id
    )
    SELECT TOP 5 caminho, COUNT(*) AS total
    FROM Caminho
    WHERE (@dataInicio IS NULL OR ultimaMudanca >= @dataInicio)
      AND (@dataFim IS NULL OR ultimaMudanca < DATEADD(day, 1, @dataFim))
    GROUP BY caminho
    ORDER BY total DESC
  `);

  return result.recordset.map((row) => ({ caminho: row.caminho, total: row.total }));
}

async function getStatusPulados(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT COUNT(*) AS total
    FROM ConversasStatus cs
    JOIN Contatos c ON c.id = cs.contato_id
    WHERE cs.status = 'venda'
      AND (@estadoId IS NULL OR c.estado_id = @estadoId)
      AND (@dataInicio IS NULL OR cs.atualizado_em >= @dataInicio)
      AND (@dataFim IS NULL OR cs.atualizado_em < DATEADD(day, 1, @dataFim))
      AND NOT EXISTS (
        SELECT 1 FROM StatusHistorico sh
        WHERE sh.contato_id = cs.contato_id AND sh.numero_remetente_id = cs.numero_remetente_id AND sh.status_novo = 'agendou'
      )
  `);

  return { total: result.recordset[0]?.total ?? 0 };
}

async function getOrigemPorDia(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT CAST(sh.alterado_em AS DATE) AS dia, sh.origem, COUNT(*) AS total
    FROM StatusHistorico sh
    JOIN Contatos c ON c.id = sh.contato_id
    WHERE sh.alterado_em >= DATEADD(DAY, -30, SYSUTCDATETIME())
      AND (@estadoId IS NULL OR c.estado_id = @estadoId)
      AND (@dataInicio IS NULL OR sh.alterado_em >= @dataInicio)
      AND (@dataFim IS NULL OR sh.alterado_em < DATEADD(day, 1, @dataFim))
    GROUP BY CAST(sh.alterado_em AS DATE), sh.origem
    ORDER BY dia ASC
  `);

  const porDia = new Map();
  for (const row of result.recordset) {
    const chave = row.dia instanceof Date ? row.dia.toISOString().slice(0, 10) : String(row.dia).slice(0, 10);
    if (!porDia.has(chave)) {
      porDia.set(chave, { sistema: 0, atendente: 0 });
    }
    const entrada = porDia.get(chave);
    if (row.origem === 'sistema') {
      entrada.sistema = row.total;
    } else {
      entrada.atendente = row.total;
    }
  }

  const dias = [];
  const hoje = new Date();
  for (let i = 29; i >= 0; i -= 1) {
    const data = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i));
    const chave = data.toISOString().slice(0, 10);
    const entrada = porDia.get(chave) ?? { sistema: 0, atendente: 0 };
    dias.push({ dia: chave, sistema: entrada.sistema, atendente: entrada.atendente });
  }

  return dias;
}

async function getMotivosPerdido(pool, { estadoId, dataInicio, dataFim } = {}) {
  const result = await novoRequestComFiltros(pool, { estadoId, dataInicio, dataFim }).query(`
    SELECT sh.motivo, COUNT(*) AS total
    FROM StatusHistorico sh
    JOIN Contatos c ON c.id = sh.contato_id
    WHERE sh.status_novo = 'perdido'
      AND sh.motivo IS NOT NULL
      AND (@estadoId IS NULL OR c.estado_id = @estadoId)
      AND (@dataInicio IS NULL OR sh.alterado_em >= @dataInicio)
      AND (@dataFim IS NULL OR sh.alterado_em < DATEADD(day, 1, @dataFim))
    GROUP BY sh.motivo
    ORDER BY total DESC
  `);

  return result.recordset.map((row) => ({ motivo: row.motivo, total: row.total }));
}

async function getDashboard({ estadoId, dataInicio, dataFim } = {}) {
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
    tempoMedioPorEtapa,
    tempoMedioConversao,
    velocidadeRespostaAtendente,
    taxaRecuo,
    caminhosComuns,
    statusPulados,
    origemPorDia,
    motivosPerdido,
  ] = await Promise.all([
    getTotalDisparos(pool, { estadoId, dataInicio, dataFim }),
    getTaxas(pool, { estadoId, dataInicio, dataFim }),
    getDisparosPorRegiao(pool, { estadoId, dataInicio, dataFim }),
    getStatusGeral(pool, { estadoId, dataInicio, dataFim }),
    getRankingAtendentes(pool, { estadoId, dataInicio, dataFim }),
    getFunilConversao(pool, { estadoId, dataInicio, dataFim }),
    getTendenciaDiaria(pool, { estadoId, dataInicio, dataFim }),
    getComparativoSemanal(pool, { estadoId, dataInicio, dataFim }),
    getTempoMedioPorEtapa(pool, { estadoId, dataInicio, dataFim }),
    getTempoMedioConversao(pool, { estadoId, dataInicio, dataFim }),
    getVelocidadeRespostaAtendente(pool, { estadoId, dataInicio, dataFim }),
    getTaxaRecuo(pool, { estadoId, dataInicio, dataFim }),
    getCaminhosComuns(pool, { estadoId, dataInicio, dataFim }),
    getStatusPulados(pool, { estadoId, dataInicio, dataFim }),
    getOrigemPorDia(pool, { estadoId, dataInicio, dataFim }),
    getMotivosPerdido(pool, { estadoId, dataInicio, dataFim }),
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
    tempoMedioPorEtapa,
    tempoMedioConversao,
    velocidadeRespostaAtendente,
    taxaRecuo,
    caminhosComuns,
    statusPulados,
    origemPorDia,
    motivosPerdido,
  };
}

async function getAguardandoAcao({ horasSemResposta = 24, diasAgendadoParado = 3 } = {}) {
  const pool = await getPool();
  const result = await pool.request()
    .input('horasSemResposta', sql.Int, horasSemResposta)
    .input('diasAgendadoParado', sql.Int, diasAgendadoParado)
    .query(`
      SELECT c.id AS contato_id, c.nome, c.telefone, n.id AS numero_remetente_id, n.apelido, MAX(d.criado_em) AS referencia, 'sem_resposta' AS tipo
      FROM DisparoContatos dc
      JOIN Disparos d ON d.id = dc.disparo_id
      JOIN Contatos c ON c.id = dc.contato_id
      JOIN NumerosRemetentes n ON n.id = d.numero_remetente_id
      WHERE NOT EXISTS (
        SELECT 1 FROM ConversasStatus cs WHERE cs.contato_id = c.id AND cs.numero_remetente_id = d.numero_remetente_id
      )
      GROUP BY c.id, c.nome, c.telefone, n.id, n.apelido, d.numero_remetente_id
      HAVING MAX(d.criado_em) <= DATEADD(HOUR, -@horasSemResposta, SYSUTCDATETIME())

      UNION ALL

      SELECT c.id, c.nome, c.telefone, n.id, n.apelido, cs.atualizado_em AS referencia, 'agendado_parado' AS tipo
      FROM ConversasStatus cs
      JOIN Contatos c ON c.id = cs.contato_id
      JOIN NumerosRemetentes n ON n.id = cs.numero_remetente_id
      WHERE cs.status = 'agendou' AND cs.atualizado_em <= DATEADD(DAY, -@diasAgendadoParado, SYSUTCDATETIME())

      ORDER BY referencia ASC
    `);

  return result.recordset.map((row) => ({
    contatoId: row.contato_id,
    numeroRemetenteId: row.numero_remetente_id,
    nome: row.nome,
    telefone: row.telefone,
    apelido: row.apelido,
    referencia: row.referencia,
    tipo: row.tipo,
  }));
}

module.exports = {
  getDashboard,
  getAguardandoAcao,
  // Helpers individuais exportados só para teste unitário isolado (mesmo padrão já usado em
  // baileysSession.service.js para funções puras como desembrulharMensagem/gerarVariantesTelefoneBr)
  // — getDashboard roda todas via Promise.all e não dá pra testar cada branch de forma isolada e
  // legível através dele sem encadear ~17 chamadas de pool.request() em ordem exata.
  _internal: {
    getTotalDisparos,
    getTaxas,
    getDisparosPorRegiao,
    getStatusGeral,
    getRankingAtendentes,
    getFunilConversao,
    getTendenciaDiaria,
    getTaxasEmPeriodo,
    getComparativoSemanal,
    getTempoMedioPorEtapa,
    getTempoMedioConversao,
    getVelocidadeRespostaAtendente,
    getTaxaRecuo,
    getCaminhosComuns,
    getStatusPulados,
    getOrigemPorDia,
    getMotivosPerdido,
  },
};
