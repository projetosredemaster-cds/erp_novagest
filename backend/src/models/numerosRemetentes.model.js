const { sql, getPool } = require('../config/db');

const SELECT_NUMERO_COM_ESTADO = `
  SELECT
    n.id,
    n.apelido,
    n.numero,
    n.status_conexao,
    n.ativo,
    n.criado_em,
    e.id AS estado_id,
    e.nome AS estado_nome,
    e.uf AS estado_uf
  FROM NumerosRemetentes n
  JOIN Estados e ON e.id = n.estado_id
`;

function mapNumeroRow(row) {
  const { estado_id: estadoId, estado_nome: estadoNome, estado_uf: estadoUf, status_conexao: statusConexao, ...resto } = row;
  return {
    ...resto,
    statusConexao,
    estado: { id: estadoId, nome: estadoNome, uf: estadoUf },
  };
}

async function listNumeros() {
  const pool = await getPool();
  const result = await pool.request().query(`
    ${SELECT_NUMERO_COM_ESTADO}
    ORDER BY n.apelido
  `);
  return result.recordset.map(mapNumeroRow);
}

async function existeEstado(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Estados WHERE id = @id');
  return result.recordset.length > 0;
}

async function findNumeroById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      ${SELECT_NUMERO_COM_ESTADO}
      WHERE n.id = @id
    `);
  const row = result.recordset[0];
  return row ? mapNumeroRow(row) : undefined;
}

async function insertNumero({ estadoId, apelido }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('estadoId', sql.Int, estadoId)
    .input('apelido', sql.NVarChar, apelido)
    .query(`
      INSERT INTO NumerosRemetentes (estado_id, apelido, numero, status_conexao, ativo, criado_em)
      OUTPUT inserted.id
      VALUES (@estadoId, @apelido, NULL, 'aguardando_conexao', 1, SYSUTCDATETIME())
    `);

  return findNumeroById(result.recordset[0].id);
}

async function updateNumero(id, { apelido, estadoId, ativo }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('apelido', sql.NVarChar, apelido ?? null)
    .input('estadoId', sql.Int, estadoId ?? null)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null)
    .query(`
      UPDATE NumerosRemetentes
      SET
        apelido = COALESCE(@apelido, apelido),
        estado_id = COALESCE(@estadoId, estado_id),
        ativo = COALESCE(@ativo, ativo)
      WHERE id = @id
    `);
}

/**
 * Exclui um número remetente se não houver Contatos nem LoteImportacaoEscolhas
 * vinculados a ele. Retorna 'not_found' | 'has_vinculos' | 'deleted'.
 */
async function deleteNumeroIfNoVinculos(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const numeroRequest = new sql.Request(transaction);
    numeroRequest.input('id', sql.Int, id);
    const numeroResult = await numeroRequest.query('SELECT id FROM NumerosRemetentes WHERE id = @id');

    if (!numeroResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const contatosRequest = new sql.Request(transaction);
    contatosRequest.input('id', sql.Int, id);
    const contatosResult = await contatosRequest.query(
      'SELECT COUNT(*) AS total FROM Contatos WHERE numero_remetente_id = @id'
    );

    if (contatosResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_vinculos';
    }

    const escolhasRequest = new sql.Request(transaction);
    escolhasRequest.input('id', sql.Int, id);
    const escolhasResult = await escolhasRequest.query(
      'SELECT COUNT(*) AS total FROM LoteImportacaoEscolhas WHERE numero_remetente_id = @id'
    );

    if (escolhasResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_vinculos';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM NumerosRemetentes WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listNumeros,
  existeEstado,
  findNumeroById,
  insertNumero,
  updateNumero,
  deleteNumeroIfNoVinculos,
};
