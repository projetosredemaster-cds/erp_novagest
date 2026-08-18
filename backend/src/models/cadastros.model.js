const { sql, getPool } = require('../config/db');
const SELECT_REDE_COM_RESPONSAVEL = `
  SELECT
    r.id,
    r.diretor_id,
    r.nome,
    r.emoji,
    r.ativo,
    r.visivel,
    r.responsavel_id,
    resp.nome AS responsavel_nome,
    r.criado_em
  FROM Redes r
  LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
`;

function mapRedeRow(row) {
  const { responsavel_id: responsavelId, responsavel_nome: responsavelNome, ...resto } = row;
  return {
    ...resto,
    responsavel: responsavelId != null ? { id: responsavelId, nome: responsavelNome } : null,
  };
}

async function listDiretoresComRedes() {
  const pool = await getPool();

  const diretoresResult = await pool.request().query(`
    SELECT id, nome, criado_em
    FROM Diretores
    ORDER BY nome
  `);

  const redesResult = await pool.request().query(`
    ${SELECT_REDE_COM_RESPONSAVEL}
    ORDER BY r.nome
  `);

  const redesPorDiretor = new Map();
  for (const rede of redesResult.recordset) {
    if (!redesPorDiretor.has(rede.diretor_id)) {
      redesPorDiretor.set(rede.diretor_id, []);
    }
    redesPorDiretor.get(rede.diretor_id).push(mapRedeRow(rede));
  }

  return diretoresResult.recordset.map((diretor) => ({
    ...diretor,
    redes: redesPorDiretor.get(diretor.id) || [],
  }));
}
async function getDiretorComRedesById(id) {
  const pool = await getPool();

  const diretorResult = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, nome, criado_em FROM Diretores WHERE id = @id');

  const diretor = diretorResult.recordset[0];
  if (!diretor) {
    return undefined;
  }

  const redesResult = await pool
    .request()
    .input('diretorId', sql.Int, id)
    .query(`
      ${SELECT_REDE_COM_RESPONSAVEL}
      WHERE r.diretor_id = @diretorId
      ORDER BY r.nome
    `);

  return { ...diretor, redes: redesResult.recordset.map(mapRedeRow) };
}
async function existeDiretorComNome(nome, excludeId = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .input('excludeId', sql.Int, excludeId)
    .query(`
      SELECT COUNT(*) AS total
      FROM Diretores
      WHERE LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
        AND (@excludeId IS NULL OR id <> @excludeId)
    `);
  return result.recordset[0].total > 0;
}
async function insertDiretor({ nome }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .query(`
      INSERT INTO Diretores (nome, criado_em)
      OUTPUT inserted.id, inserted.nome, inserted.criado_em
      VALUES (@nome, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}
async function findDiretorById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, nome, criado_em FROM Diretores WHERE id = @id');
  return result.recordset[0];
}
async function updateDiretor(id, { nome }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .query(`
      UPDATE Diretores
      SET nome = COALESCE(@nome, nome)
      WHERE id = @id
    `);
}
async function deleteDiretorIfNoRedes(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const diretorRequest = new sql.Request(transaction);
    diretorRequest.input('id', sql.Int, id);
    const diretorResult = await diretorRequest.query(
      'SELECT id FROM Diretores WHERE id = @id'
    );

    if (!diretorResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const countRequest = new sql.Request(transaction);
    countRequest.input('diretorId', sql.Int, id);
    const countResult = await countRequest.query(
      'SELECT COUNT(*) AS total FROM Redes WHERE diretor_id = @diretorId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_redes';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM Diretores WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
async function existeRedeComNomeNoDiretor({ nome, diretorId, excludeId = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .input('diretorId', sql.Int, diretorId)
    .input('excludeId', sql.Int, excludeId)
    .query(`
      SELECT COUNT(*) AS total
      FROM Redes
      WHERE diretor_id = @diretorId
        AND LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
        AND (@excludeId IS NULL OR id <> @excludeId)
    `);
  return result.recordset[0].total > 0;
}
async function insertRede({ diretorId, nome, emoji }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('diretorId', sql.Int, diretorId)
    .input('nome', sql.NVarChar, nome)
    .input('emoji', sql.NVarChar, emoji ?? null)
    .query(`
      INSERT INTO Redes (diretor_id, nome, emoji, ativo, visivel, responsavel_id, criado_em)
      OUTPUT inserted.id, inserted.diretor_id, inserted.nome, inserted.emoji,
             inserted.ativo, inserted.visivel, inserted.criado_em
      VALUES (@diretorId, @nome, @emoji, 1, 1, NULL, SYSUTCDATETIME())
    `);
  return { ...result.recordset[0], responsavel: null };
}
async function findRedeById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      ${SELECT_REDE_COM_RESPONSAVEL}
      WHERE r.id = @id
    `);
  const rede = result.recordset[0];
  return rede ? mapRedeRow(rede) : undefined;
}
async function existeRede(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Redes WHERE id = @id');
  return result.recordset.length > 0;
}
async function existeDiretor(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Diretores WHERE id = @id');
  return result.recordset.length > 0;
}
async function listRedesComDiretorResponsavelLojas() {
  const pool = await getPool();

  const redesResult = await pool.request().query(`
    SELECT r.id, r.diretor_id, d.nome AS diretor_nome, r.nome, r.emoji,
           r.ativo, r.visivel, resp.id AS responsavel_id, resp.nome AS responsavel_nome,
           r.criado_em
    FROM Redes r
    JOIN Diretores d ON d.id = r.diretor_id
    LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
    ORDER BY r.nome
  `);

  const lojasResult = await pool.request().query(`
    SELECT id, rede_id, nome, ativo, criado_em FROM Lojas ORDER BY nome
  `);

  const lojasPorRede = new Map();
  for (const loja of lojasResult.recordset) {
    if (!lojasPorRede.has(loja.rede_id)) {
      lojasPorRede.set(loja.rede_id, []);
    }
    lojasPorRede.get(loja.rede_id).push(loja);
  }

  return redesResult.recordset.map((row) => ({
    id: row.id,
    nome: row.nome,
    emoji: row.emoji,
    ativo: row.ativo,
    visivel: row.visivel,
    diretor: { id: row.diretor_id, nome: row.diretor_nome },
    responsavel: row.responsavel_id != null ? { id: row.responsavel_id, nome: row.responsavel_nome } : null,
    criado_em: row.criado_em,
    lojas: lojasPorRede.get(row.id) || [],
  }));
}
async function updateRede(id, { nome, emoji, responsavelId, ativo, visivel, diretorId }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('emoji', sql.NVarChar, emoji !== undefined ? emoji : null)
    .input('emojiInformado', sql.Bit, emoji !== undefined ? 1 : 0)
    .input('responsavelId', sql.Int, responsavelId !== undefined ? responsavelId : null)
    .input('responsavelIdInformado', sql.Bit, responsavelId !== undefined ? 1 : 0)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null)
    .input('visivel', sql.Bit, visivel !== undefined ? visivel : null)
    .input('visivelInformado', sql.Bit, visivel !== undefined ? 1 : 0)
    .input('diretorId', sql.Int, diretorId ?? null)
    .query(`
      UPDATE Redes
      SET
        nome = COALESCE(@nome, nome),
        emoji = CASE WHEN @emojiInformado = 1 THEN @emoji ELSE emoji END,
        responsavel_id = CASE WHEN @responsavelIdInformado = 1 THEN @responsavelId ELSE responsavel_id END,
        ativo = COALESCE(@ativo, ativo),
        visivel = CASE WHEN @visivelInformado = 1 THEN @visivel ELSE visivel END,
        diretor_id = COALESCE(@diretorId, diretor_id)
      WHERE id = @id
    `);
}
async function deleteRedeIfNoEntradas(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const redeRequest = new sql.Request(transaction);
    redeRequest.input('id', sql.Int, id);
    const redeResult = await redeRequest.query(
      'SELECT id FROM Redes WHERE id = @id'
    );

    if (!redeResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const lojasCountRequest = new sql.Request(transaction);
    lojasCountRequest.input('redeId', sql.Int, id);
    const lojasCountResult = await lojasCountRequest.query(
      'SELECT COUNT(*) AS total FROM Lojas WHERE rede_id = @redeId'
    );

    if (lojasCountResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_lojas';
    }

    const countRequest = new sql.Request(transaction);
    countRequest.input('redeId', sql.Int, id);
    const countResult = await countRequest.query(
      'SELECT COUNT(*) AS total FROM Entradas WHERE rede_id = @redeId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_entradas';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM Redes WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
async function existeLojaComNomeNaRede({ nome, redeId, excludeId = null }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .input('redeId', sql.Int, redeId)
    .input('excludeId', sql.Int, excludeId)
    .query(`
      SELECT COUNT(*) AS total
      FROM Lojas
      WHERE rede_id = @redeId
        AND LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
        AND (@excludeId IS NULL OR id <> @excludeId)
    `);
  return result.recordset[0].total > 0;
}
async function insertLoja({ redeId, nome }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('redeId', sql.Int, redeId)
    .input('nome', sql.NVarChar, nome)
    .query(`
      INSERT INTO Lojas (rede_id, nome, ativo, criado_em)
      OUTPUT inserted.id, inserted.rede_id, inserted.nome, inserted.ativo, inserted.criado_em
      VALUES (@redeId, @nome, 1, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}
async function findLojaById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, rede_id, nome, ativo, criado_em FROM Lojas WHERE id = @id');
  return result.recordset[0];
}
async function updateLoja(id, { nome, ativo, redeId }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null)
    .input('redeId', sql.Int, redeId ?? null)
    .query(`
      UPDATE Lojas
      SET
        nome = COALESCE(@nome, nome),
        ativo = COALESCE(@ativo, ativo),
        rede_id = COALESCE(@redeId, rede_id)
      WHERE id = @id
    `);
}
async function existeResponsavel(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Responsaveis WHERE id = @id');
  return result.recordset.length > 0;
}
async function listResponsaveis() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, criado_em
    FROM Responsaveis
    ORDER BY nome
  `);
  return result.recordset;
}
async function existeResponsavelComNome(nome) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .query(`
      SELECT COUNT(*) AS total
      FROM Responsaveis
      WHERE LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
    `);
  return result.recordset[0].total > 0;
}
async function insertResponsavel({ nome }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .query(`
      INSERT INTO Responsaveis (nome, criado_em)
      OUTPUT inserted.id, inserted.nome, inserted.criado_em
      VALUES (@nome, SYSUTCDATETIME())
    `);
  return result.recordset[0];
}
async function deleteResponsavelIfNoRedes(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const responsavelRequest = new sql.Request(transaction);
    responsavelRequest.input('id', sql.Int, id);
    const responsavelResult = await responsavelRequest.query(
      'SELECT id FROM Responsaveis WHERE id = @id'
    );

    if (!responsavelResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const countRequest = new sql.Request(transaction);
    countRequest.input('responsavelId', sql.Int, id);
    const countResult = await countRequest.query(
      'SELECT COUNT(*) AS total FROM Redes WHERE responsavel_id = @responsavelId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_redes';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM Responsaveis WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  listDiretoresComRedes,
  getDiretorComRedesById,
  insertDiretor,
  findDiretorById,
  updateDiretor,
  existeDiretorComNome,
  deleteDiretorIfNoRedes,
  insertRede,
  findRedeById,
  existeRede,
  existeDiretor,
  listRedesComDiretorResponsavelLojas,
  updateRede,
  existeRedeComNomeNoDiretor,
  deleteRedeIfNoEntradas,
  existeLojaComNomeNaRede,
  insertLoja,
  findLojaById,
  updateLoja,
  existeResponsavel,
  listResponsaveis,
  existeResponsavelComNome,
  insertResponsavel,
  deleteResponsavelIfNoRedes,
};
