const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Ranking.
 *
 * IMPORTANTE — hierarquia de dados (v2, ver CONTRATO-RANKING-API.md):
 *   - Diretores   (id, nome, criado_em) — o que antes era `Redes`.
 *   - Redes       (id, diretor_id -> FK Diretores, nome, emoji, ativo,
 *                 visivel, responsavel_id -> FK Responsaveis, criado_em) —
 *                 o que antes era `Lojas`. O Ranking lança valores neste
 *                 nível, nunca em `Lojas` (tabela física nova do módulo
 *                 Margens, não usada aqui).
 *   - Categorias  (id, nome, principal, criado_em) — sem mudança.
 *   - Entradas    (id, data_ref, categoria_id -> FK Categorias, rede_id -> FK
 *                 Redes, valor, atualizado_em; UNIQUE em
 *                 data_ref+categoria_id+rede_id). No schema local (criado do
 *                 zero, sem migration de rename), a coluna já nasceu com o
 *                 nome `rede_id` — leitura/escrita direta, sem alias.
 *   - Responsaveis (id, nome, criado_em) — sem mudança; a FK que a
 *                 referencia (`responsavel_id`) migrou de `Diretores` para
 *                 `Redes`, mas como o nome da tabela `Redes` já aponta para
 *                 a entidade certa após o rename, nenhuma query aqui
 *                 precisou mudar.
 *
 * Todas as queries são parametrizadas via `request.input(...)` — nunca
 * concatenar valores vindos do usuário diretamente na string SQL.
 */

async function listEntradas({ data, categoriaId }) {
  const pool = await getPool();
  const request = pool.request();
  request.input('data', sql.Date, data);
  request.input('categoriaId', sql.Int, categoriaId);

  const result = await request.query(`
    SELECT
      e.id,
      e.data_ref,
      e.categoria_id,
      e.rede_id,
      e.valor,
      e.atualizado_em,
      r.nome  AS rede_nome,
      r.emoji AS rede_emoji,
      r.diretor_id
    FROM Entradas e
    INNER JOIN Redes r ON r.id = e.rede_id
    WHERE e.data_ref = @data
      AND e.categoria_id = @categoriaId
    ORDER BY e.valor DESC
  `);

  return result.recordset;
}

/**
 * Cria ou atualiza (upsert) uma entrada, identificada pela combinação
 * (data_ref, categoria_id, rede_id), usando MERGE dentro de uma transação.
 */
async function upsertEntrada({ data, categoriaId, redeId, valor }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request.input('data', sql.Date, data);
    request.input('categoriaId', sql.Int, categoriaId);
    request.input('redeId', sql.Int, redeId);
    request.input('valor', sql.Decimal(18, 2), valor);

    const result = await request.query(`
      MERGE INTO Entradas AS target
      USING (SELECT @data AS data_ref, @categoriaId AS categoria_id, @redeId AS rede_id) AS source
        ON target.data_ref = source.data_ref
        AND target.categoria_id = source.categoria_id
        AND target.rede_id = source.rede_id
      WHEN MATCHED THEN
        UPDATE SET valor = @valor, atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, categoria_id, rede_id, valor, atualizado_em)
        VALUES (@data, @categoriaId, @redeId, @valor, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.data_ref,
        inserted.categoria_id,
        inserted.rede_id,
        inserted.valor,
        inserted.atualizado_em;
    `);

    await transaction.commit();
    return result.recordset[0];
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Consulta base de Redes com LEFT JOIN em Responsaveis (via responsavel_id),
 * usada por `listDiretoresComRedes`, `getDiretorComRedesById` e
 * `findRedeById`. `Redes` é o nível que ganhou `responsavel_id`/`visivel`
 * nesta versão do schema (antes vivia em `Diretores`, quando esta tabela
 * ainda se chamava `Redes`).
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

async function listCategorias() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, nome, principal, criado_em
    FROM Categorias
    ORDER BY nome
  `);
  return result.recordset;
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
 * `PUT /redes/:id`, seção 6 do contrato).
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
 * Verifica existência + bloqueio de vínculo (entradas) e exclui a rede, tudo
 * dentro de uma transação, para evitar condição de corrida entre o SELECT de
 * checagem e o DELETE.
 * Retorna 'not_found' | 'has_entradas' | 'deleted'.
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
 * ignorando espaços extras no início/fim). Mesmo padrão de
 * `existeDiretorComNome`/`existeRedeComNomeNoDiretor`.
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
 * SELECT de checagem e o DELETE. Mesmo padrão de
 * `deleteDiretorIfNoRedes`/`deleteRedeIfNoEntradas`.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
 *
 * Nota: o vínculo checado (`Redes.responsavel_id`) agora é com a Rede
 * (Delta, Lendários...), não mais com o Diretor — a query não precisou
 * mudar porque `Redes` já é o nome da tabela certa após o rename do schema.
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
  listEntradas,
  upsertEntrada,
  listDiretoresComRedes,
  listCategorias,
  getDiretorComRedesById,
  insertDiretor,
  findDiretorById,
  updateDiretor,
  existeDiretorComNome,
  deleteDiretorIfNoRedes,
  insertRede,
  findRedeById,
  updateRede,
  existeRedeComNomeNoDiretor,
  deleteRedeIfNoEntradas,
  existeResponsavel,
  listResponsaveis,
  existeResponsavelComNome,
  insertResponsavel,
  deleteResponsavelIfNoRedes,
};
