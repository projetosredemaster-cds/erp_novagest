const { sql, getPool } = require('../config/db');

async function listEstadosComDDDs() {
  const pool = await getPool();

  const estadosResult = await pool
    .request()
    .query('SELECT id, nome, uf, criado_em FROM Estados ORDER BY nome');

  const dddsResult = await pool
    .request()
    .query('SELECT estado_id, ddd FROM EstadoDDDs ORDER BY ddd');

  const dddsPorEstado = new Map();
  for (const row of dddsResult.recordset) {
    if (!dddsPorEstado.has(row.estado_id)) {
      dddsPorEstado.set(row.estado_id, []);
    }
    dddsPorEstado.get(row.estado_id).push(row.ddd);
  }

  return estadosResult.recordset.map((estado) => ({
    ...estado,
    ddds: dddsPorEstado.get(estado.id) || [],
  }));
}

async function existeEstado(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Estados WHERE id = @id');
  return result.recordset.length > 0;
}

/**
 * Cria um Estado novo junto com seus DDDs, validando dentro da mesma
 * transação: UF já cadastrada (409) e DDD já pertencente a outro Estado (409).
 * Retorna { status: 'uf_duplicada' } | { status: 'ddd_duplicado', ddd, estadoNome } |
 * { status: 'criado', estado }.
 */
async function criarEstadoComDDDs({ nome, uf, ddds }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const ufRequest = new sql.Request(transaction);
    ufRequest.input('uf', sql.Char(2), uf);
    const ufResult = await ufRequest.query('SELECT id FROM Estados WHERE uf = @uf');

    if (ufResult.recordset[0]) {
      await transaction.rollback();
      return { status: 'uf_duplicada' };
    }

    for (const ddd of ddds) {
      const dddRequest = new sql.Request(transaction);
      dddRequest.input('ddd', sql.Char(2), ddd);
      const dddResult = await dddRequest.query(`
        SELECT e.nome AS estado_nome
        FROM EstadoDDDs ed
        JOIN Estados e ON e.id = ed.estado_id
        WHERE ed.ddd = @ddd
      `);

      if (dddResult.recordset[0]) {
        await transaction.rollback();
        return { status: 'ddd_duplicado', ddd, estadoNome: dddResult.recordset[0].estado_nome };
      }
    }

    const estadoRequest = new sql.Request(transaction);
    estadoRequest.input('nome', sql.NVarChar, nome);
    estadoRequest.input('uf', sql.Char(2), uf);
    const estadoResult = await estadoRequest.query(`
      INSERT INTO Estados (nome, uf, criado_em)
      OUTPUT inserted.id, inserted.nome, inserted.uf, inserted.criado_em
      VALUES (@nome, @uf, SYSUTCDATETIME())
    `);
    const estado = estadoResult.recordset[0];

    for (const ddd of ddds) {
      const insertDddRequest = new sql.Request(transaction);
      insertDddRequest.input('estadoId', sql.Int, estado.id);
      insertDddRequest.input('ddd', sql.Char(2), ddd);
      await insertDddRequest.query(`
        INSERT INTO EstadoDDDs (estado_id, ddd) VALUES (@estadoId, @ddd)
      `);
    }

    await transaction.commit();
    return { status: 'criado', estado: { ...estado, ddds } };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listEstadosComDDDs,
  existeEstado,
  criarEstadoComDDDs,
};
