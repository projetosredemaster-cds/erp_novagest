const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Cadastros.
 *
 * Cadastro compartilhado entre módulos de negócio (Ranking, Margens, e
 * futuros) — ver CONTRATO-CADASTROS-API.md. Este módulo é dono do CRUD de
 * Diretor/Rede/Loja/Responsavel; o Ranking só LÊ Redes (JOIN em
 * `ranking.model.js`, para montar rede_nome/rede_emoji nas Entradas) e o
 * Margens só lê `GET /api/cadastros/redes` para montar seu relatório.
 *
 * Hierarquia (ver CLAUDE.md, "Schema do Ranking (v2)"):
 *   - Diretores    (id, nome, criado_em)
 *   - Redes        (id, diretor_id -> FK Diretores, nome, emoji, ativo,
 *                   visivel, responsavel_id -> FK Responsaveis, criado_em)
 *   - Lojas        (id, rede_id -> FK Redes, nome, ativo, criado_em) — loja
 *                   física (ex: "SLZ 01"), consumida hoje só pelo Margens.
 *   - Responsaveis (id, nome, criado_em)
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 */

/**
 * Consulta base de Redes com LEFT JOIN em Responsaveis (via responsavel_id),
 * usada por `listDiretoresComRedes`, `getDiretorComRedesById` e
 * `findRedeById`.
 */
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

/**
 * Converte uma linha crua do SELECT acima (com `responsavel_id` +
 * `responsavel_nome` separados) no shape de resposta da API, com
 * `responsavel` como objeto `{ id, nome }` ou `null`.
 */
function mapRedeRow(row) {
  const { responsavel_id: responsavelId, responsavel_nome: responsavelNome, ...resto } = row;
  return {
    ...resto,
    responsavel: responsavelId != null ? { id: responsavelId, nome: responsavelNome } : null,
  };
}

/**
 * Lista todos os diretores, cada um com o array `redes` aninhado (montado em
 * memória, agrupando pelo `diretor_id` de cada rede).
 */
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

/**
 * Busca um diretor por id, já com o array `redes` aninhado (mesmo shape de
 * `listDiretoresComRedes`). Retorna `undefined` se o diretor não existir.
 */
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

/**
 * Verifica se já existe um diretor com o mesmo `nome` (case-insensitive,
 * ignorando espaços extras no início/fim). Se `excludeId` for informado, o
 * próprio diretor com esse id é excluído da checagem (usado no PUT, para não
 * bloquear reenviar o nome atual sem alteração).
 */
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

/**
 * Insere um novo diretor e retorna o registro criado (sem `redes`, quem
 * monta o shape completo é o service).
 */
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

/**
 * Busca um diretor "cru" (sem redes) por id. Retorna `undefined` se não existir.
 */
async function findDiretorById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, nome, criado_em FROM Diretores WHERE id = @id');
  return result.recordset[0];
}

/**
 * Atualização parcial de um diretor: só `nome` existe neste nível.
 */
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

/**
 * Verifica existência + bloqueio de vínculo (redes) e exclui o diretor, tudo
 * dentro de uma transação, para evitar condição de corrida entre o SELECT de
 * checagem e o DELETE.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 */
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

/**
 * Verifica se já existe uma rede com o mesmo `nome` dentro do mesmo
 * `diretor_id` (case-insensitive, ignorando espaços extras no início/fim).
 * Se `excludeId` for informado, a própria rede com esse id é excluída da
 * checagem (usado no PUT, para não bloquear reenviar o nome atual sem
 * alteração).
 */
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

/**
 * Insere uma nova rede vinculada a um diretor existente e retorna o
 * registro criado. Toda rede nova é criada com `responsavel_id = NULL` —
 * este endpoint não aceita atribuir um responsável na criação (ver
 * `PUT /redes/:id`, seção 7 do contrato).
 */
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

/**
 * Busca uma rede por id, já com `responsavel` mapeado. Retorna `undefined`
 * se não existir.
 */
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

/**
 * Verifica se existe uma rede com o `id` informado. Usada pela validação de
 * `redeId` na criação de Loja.
 */
async function existeRede(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Redes WHERE id = @id');
  return result.recordset.length > 0;
}

/**
 * Lista todas as redes visíveis, cada uma com diretor + responsável (GG) +
 * lojas físicas aninhadas (agrupadas em memória por `rede_id`). Ver
 * CONTRATO-CADASTROS-API.md, seção 5.
 */
async function listRedesComDiretorResponsavelLojas() {
  const pool = await getPool();

  const redesResult = await pool.request().query(`
    SELECT r.id, r.diretor_id, d.nome AS diretor_nome, r.nome, r.emoji,
           r.ativo, r.visivel, resp.id AS responsavel_id, resp.nome AS responsavel_nome,
           r.criado_em
    FROM Redes r
    JOIN Diretores d ON d.id = r.diretor_id
    LEFT JOIN Responsaveis resp ON resp.id = r.responsavel_id
    WHERE r.visivel = 1
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

/**
 * Atualização parcial de uma rede: campos ausentes (undefined) permanecem
 * com o valor atual no banco via COALESCE. `responsavelId` é a exceção
 * "parcial com null explícito": quando presente (mesmo `null`), sobrescreve
 * `responsavel_id` (permitindo desatribuir o responsável); só a AUSÊNCIA do
 * campo no corpo preserva o valor atual. Mesma lógica para `emoji`.
 */
async function updateRede(id, { nome, emoji, responsavelId, ativo, visivel }) {
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
    .query(`
      UPDATE Redes
      SET
        nome = COALESCE(@nome, nome),
        emoji = CASE WHEN @emojiInformado = 1 THEN @emoji ELSE emoji END,
        responsavel_id = CASE WHEN @responsavelIdInformado = 1 THEN @responsavelId ELSE responsavel_id END,
        ativo = COALESCE(@ativo, ativo),
        visivel = CASE WHEN @visivelInformado = 1 THEN @visivel ELSE visivel END
      WHERE id = @id
    `);
}

/**
 * Verifica existência + bloqueio de vínculo (lojas físicas, depois entradas)
 * e exclui a rede, tudo dentro de uma transação, para evitar condição de
 * corrida entre os SELECTs de checagem e o DELETE.
 *
 * A checagem de Lojas roda ANTES da de Entradas de propósito: sem ela, uma
 * rede com Loja vinculada mas sem Entrada nenhuma passava direto pro DELETE
 * e quebrava a constraint `FK_Lojas_Redes` no banco, vazando um 500 cru em
 * vez de um 409 de negócio (achado de QA no smoke test de cadastros).
 *
 * Retorna 'not_found' | 'has_lojas' | 'has_entradas' | 'deleted'.
 */
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

/**
 * Verifica se já existe uma loja com o mesmo `nome` dentro da mesma
 * `rede_id` (case-insensitive, ignorando espaços extras no início/fim). Se
 * `excludeId` for informado, a própria loja com esse id é excluída da
 * checagem (usado no PUT).
 */
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

/**
 * Insere uma nova loja física vinculada a uma rede existente e retorna o
 * registro criado.
 */
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

/**
 * Busca uma loja por id. Retorna `undefined` se não existir.
 */
async function findLojaById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, rede_id, nome, ativo, criado_em FROM Lojas WHERE id = @id');
  return result.recordset[0];
}

/**
 * Atualização parcial de uma loja: `nome`/`ativo`, ausência de campo
 * preserva o valor atual via COALESCE.
 */
async function updateLoja(id, { nome, ativo }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null)
    .query(`
      UPDATE Lojas
      SET
        nome = COALESCE(@nome, nome),
        ativo = COALESCE(@ativo, ativo)
      WHERE id = @id
    `);
}

/**
 * Verifica existência + bloqueio de vínculo (lançamentos de margem) e exclui
 * a loja, tudo dentro de uma transação, para evitar condição de corrida
 * entre o SELECT de checagem e o DELETE.
 * Retorna 'not_found' | 'has_margens_entradas' | 'deleted'.
 */
async function deleteLojaIfNoMargensEntradas(id) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const lojaRequest = new sql.Request(transaction);
    lojaRequest.input('id', sql.Int, id);
    const lojaResult = await lojaRequest.query(
      'SELECT id FROM Lojas WHERE id = @id'
    );

    if (!lojaResult.recordset[0]) {
      await transaction.rollback();
      return 'not_found';
    }

    const countRequest = new sql.Request(transaction);
    countRequest.input('lojaId', sql.Int, id);
    const countResult = await countRequest.query(
      'SELECT COUNT(*) AS total FROM MargensEntradas WHERE loja_id = @lojaId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_margens_entradas';
    }

    const deleteRequest = new sql.Request(transaction);
    deleteRequest.input('id', sql.Int, id);
    await deleteRequest.query('DELETE FROM Lojas WHERE id = @id');

    await transaction.commit();
    return 'deleted';
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Verifica se existe um responsável com o `id` informado.
 */
async function existeResponsavel(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT 1 AS ok FROM Responsaveis WHERE id = @id');
  return result.recordset.length > 0;
}

/**
 * Lista todos os responsáveis cadastrados.
 */
async function listResponsaveis() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, criado_em
    FROM Responsaveis
    ORDER BY nome
  `);
  return result.recordset;
}

/**
 * Verifica se já existe um responsável com o mesmo `nome` (case-insensitive,
 * ignorando espaços extras no início/fim).
 */
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

/**
 * Insere um novo responsável e retorna o registro criado.
 */
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

/**
 * Verifica existência + bloqueio de vínculo (redes) e exclui o responsável,
 * tudo dentro de uma transação, para evitar condição de corrida entre o
 * SELECT de checagem e o DELETE.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 *
 * Nota: o vínculo checado (`Redes.responsavel_id`) é com a Rede
 * (Delta, Lendários...), não com o Diretor.
 */
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
  listRedesComDiretorResponsavelLojas,
  updateRede,
  existeRedeComNomeNoDiretor,
  deleteRedeIfNoEntradas,
  existeLojaComNomeNaRede,
  insertLoja,
  findLojaById,
  updateLoja,
  deleteLojaIfNoMargensEntradas,
  existeResponsavel,
  listResponsaveis,
  existeResponsavelComNome,
  insertResponsavel,
  deleteResponsavelIfNoRedes,
};
