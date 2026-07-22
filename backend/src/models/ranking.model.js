const { sql, getPool } = require('../config/db');

/**
 * Camada de acesso a dados (data access) do módulo Ranking.
 *
 * IMPORTANTE — suposição de schema:
 * As tabelas Redes/Lojas/Categorias/Entradas já existem no banco, mas os
 * nomes exatos de colunas não foram informados. Os nomes abaixo são um
 * PALPITE razoável e PRECISAM ser conferidos/ajustados contra o schema real:
 *   - Redes      (id, nome, responsavel [coluna antiga, não lida por código
 *                 novo], responsavel_id -> FK Responsaveis, visivel, criado_em)
 *   - Lojas      (id, rede_id -> FK Redes, nome, emoji, ativo, criado_em)
 *   - Categorias (id, nome, principal, criado_em)
 *   - Entradas   (id, data_ref, categoria_id -> FK Categorias, loja_id -> FK Lojas,
 *                 valor, atualizado_em; UNIQUE em data_ref+categoria_id+loja_id)
 *   - Responsaveis (id, nome, criado_em) — ver migrations/003_add_responsaveis.sql
 * Se os nomes reais de alguma coluna forem diferentes, ajuste as queries
 * deste arquivo — o restante da aplicação (service/controller) não precisa
 * saber de detalhes de schema.
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
      e.loja_id,
      e.valor,
      e.atualizado_em,
      l.nome  AS loja_nome,
      l.emoji AS loja_emoji,
      l.rede_id
    FROM Entradas e
    INNER JOIN Lojas l ON l.id = e.loja_id
    WHERE e.data_ref = @data
      AND e.categoria_id = @categoriaId
    ORDER BY e.valor DESC
  `);

  return result.recordset;
}

/**
 * Cria ou atualiza (upsert) uma entrada, identificada pela combinação
 * (data_ref, categoria_id, loja_id), usando MERGE dentro de uma transação.
 */
async function upsertEntrada({ data, categoriaId, lojaId, valor }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request.input('data', sql.Date, data);
    request.input('categoriaId', sql.Int, categoriaId);
    request.input('lojaId', sql.Int, lojaId);
    request.input('valor', sql.Decimal(18, 2), valor);

    const result = await request.query(`
      MERGE INTO Entradas AS target
      USING (SELECT @data AS data_ref, @categoriaId AS categoria_id, @lojaId AS loja_id) AS source
        ON target.data_ref = source.data_ref
        AND target.categoria_id = source.categoria_id
        AND target.loja_id = source.loja_id
      WHEN MATCHED THEN
        UPDATE SET valor = @valor, atualizado_em = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (data_ref, categoria_id, loja_id, valor, atualizado_em)
        VALUES (@data, @categoriaId, @lojaId, @valor, SYSUTCDATETIME())
      OUTPUT
        $action AS acao,
        inserted.id,
        inserted.data_ref,
        inserted.categoria_id,
        inserted.loja_id,
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
 * usada por `listRedesComLojas`, `getRedeComLojasById` e `findRedeById`. Não
 * lê mais a coluna antiga `Redes.responsavel` (texto livre) — só
 * `responsavel_id`, mapeado para o objeto `{ id, nome }`/`null` por
 * `mapRedeRow`.
 */
const SELECT_REDE_COM_RESPONSAVEL = `
  SELECT
    r.id,
    r.nome,
    r.responsavel_id,
    resp.nome AS responsavel_nome,
    r.visivel,
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

async function listRedesComLojas() {
  const pool = await getPool();

  const redesResult = await pool.request().query(`
    ${SELECT_REDE_COM_RESPONSAVEL}
    ORDER BY r.nome
  `);

  const lojasResult = await pool.request().query(`
    SELECT id, rede_id, nome, emoji, ativo, criado_em
    FROM Lojas
    ORDER BY nome
  `);

  const lojasPorRede = new Map();
  for (const loja of lojasResult.recordset) {
    if (!lojasPorRede.has(loja.rede_id)) {
      lojasPorRede.set(loja.rede_id, []);
    }
    lojasPorRede.get(loja.rede_id).push(loja);
  }

  return redesResult.recordset.map((rede) => ({
    ...mapRedeRow(rede),
    lojas: lojasPorRede.get(rede.id) || [],
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
 * Busca uma rede por id, já com o array `lojas` aninhado (mesmo shape de
 * `listRedesComLojas`). Retorna `undefined` se a rede não existir.
 */
async function getRedeComLojasById(id) {
  const pool = await getPool();

  const redeResult = await pool
    .request()
    .input('id', sql.Int, id)
    .query(`
      ${SELECT_REDE_COM_RESPONSAVEL}
      WHERE r.id = @id
    `);

  const rede = redeResult.recordset[0];
  if (!rede) {
    return undefined;
  }

  const lojasResult = await pool
    .request()
    .input('redeId', sql.Int, id)
    .query(`
      SELECT id, rede_id, nome, emoji, ativo, criado_em
      FROM Lojas
      WHERE rede_id = @redeId
      ORDER BY nome
    `);

  return { ...mapRedeRow(rede), lojas: lojasResult.recordset };
}

/**
 * Verifica se já existe uma rede com o mesmo `nome` (case-insensitive,
 * ignorando espaços extras no início/fim). Se `excludeId` for informado,
 * a própria rede com esse id é excluída da checagem (usado no PUT, para
 * não bloquear reenviar o nome atual sem alteração).
 */
async function existeRedeComNome(nome, excludeId = null) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .input('excludeId', sql.Int, excludeId)
    .query(`
      SELECT COUNT(*) AS total
      FROM Redes
      WHERE LOWER(LTRIM(RTRIM(nome))) = LOWER(LTRIM(RTRIM(@nome)))
        AND (@excludeId IS NULL OR id <> @excludeId)
    `);
  return result.recordset[0].total > 0;
}

/**
 * Insere uma nova rede e retorna o registro criado (sem `lojas`, quem
 * monta o shape completo é o service). Toda rede nova é criada com
 * `responsavel_id = NULL` — este endpoint não aceita mais atribuir um
 * responsável na criação (ver `PUT /redes/:id`, seção 6 do contrato).
 */
async function insertRede({ nome }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('nome', sql.NVarChar, nome)
    .query(`
      INSERT INTO Redes (nome, responsavel_id, criado_em)
      OUTPUT inserted.id, inserted.nome, inserted.visivel, inserted.criado_em
      VALUES (@nome, NULL, SYSUTCDATETIME())
    `);
  return { ...result.recordset[0], responsavel: null };
}

/**
 * Busca uma rede "crua" (sem lojas) por id. Retorna `undefined` se não existir.
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
 * Atualização parcial de uma rede: campos ausentes (undefined) permanecem
 * com o valor atual no banco via COALESCE. `responsavelId` é a exceção
 * "parcial com null explícito": quando presente (mesmo `null`), sobrescreve
 * `responsavel_id` (permitindo desatribuir o responsável); só a AUSÊNCIA do
 * campo no corpo preserva o valor atual.
 */
async function updateRede(id, { nome, responsavelId, visivel }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('responsavelId', sql.Int, responsavelId !== undefined ? responsavelId : null)
    .input('responsavelIdInformado', sql.Bit, responsavelId !== undefined ? 1 : 0)
    .input('visivel', sql.Bit, visivel !== undefined ? visivel : null)
    .input('visivelInformado', sql.Bit, visivel !== undefined ? 1 : 0)
    .query(`
      UPDATE Redes
      SET
        nome = COALESCE(@nome, nome),
        responsavel_id = CASE WHEN @responsavelIdInformado = 1 THEN @responsavelId ELSE responsavel_id END,
        visivel = CASE WHEN @visivelInformado = 1 THEN @visivel ELSE visivel END
      WHERE id = @id
    `);
}

/**
 * Verifica existência + bloqueio de vínculo (lojas) e exclui a rede, tudo
 * dentro de uma transação, para evitar condição de corrida entre o SELECT
 * de checagem e o DELETE.
 * Retorna 'not_found' | 'has_lojas' | 'deleted'.
 */
async function deleteRedeIfNoLojas(id) {
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
      'SELECT COUNT(*) AS total FROM Lojas WHERE rede_id = @redeId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_lojas';
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
 * `rede_id` (case-insensitive, ignorando espaços extras no início/fim).
 * Se `excludeId` for informado, a própria loja com esse id é excluída da
 * checagem (usado no PUT, para não bloquear reenviar o nome atual sem
 * alteração).
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
 * Insere uma nova loja e retorna o registro criado.
 */
async function insertLoja({ redeId, nome, emoji }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('redeId', sql.Int, redeId)
    .input('nome', sql.NVarChar, nome)
    .input('emoji', sql.NVarChar, emoji ?? null)
    .query(`
      INSERT INTO Lojas (rede_id, nome, emoji, ativo, criado_em)
      OUTPUT inserted.id, inserted.rede_id, inserted.nome, inserted.emoji, inserted.ativo, inserted.criado_em
      VALUES (@redeId, @nome, @emoji, 1, SYSUTCDATETIME())
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
    .query(`
      SELECT id, rede_id, nome, emoji, ativo, criado_em
      FROM Lojas
      WHERE id = @id
    `);
  return result.recordset[0];
}

/**
 * Atualização parcial de uma loja: campos ausentes (undefined) permanecem
 * com o valor atual no banco via COALESCE.
 */
async function updateLoja(id, { nome, emoji, ativo }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('nome', sql.NVarChar, nome ?? null)
    .input('emoji', sql.NVarChar, emoji !== undefined ? emoji : null)
    .input('emojiInformado', sql.Bit, emoji !== undefined ? 1 : 0)
    .input('ativo', sql.Bit, ativo !== undefined ? ativo : null)
    .query(`
      UPDATE Lojas
      SET
        nome = COALESCE(@nome, nome),
        emoji = CASE WHEN @emojiInformado = 1 THEN @emoji ELSE emoji END,
        ativo = COALESCE(@ativo, ativo)
      WHERE id = @id
    `);
}

/**
 * Verifica existência + bloqueio de vínculo (entradas) e exclui a loja,
 * tudo dentro de uma transação, para evitar condição de corrida entre o
 * SELECT de checagem e o DELETE.
 * Retorna 'not_found' | 'has_entradas' | 'deleted'.
 */
async function deleteLojaIfNoEntradas(id) {
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
      'SELECT COUNT(*) AS total FROM Entradas WHERE loja_id = @lojaId'
    );

    if (countResult.recordset[0].total > 0) {
      await transaction.rollback();
      return 'has_entradas';
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
 * `existeRedeComNome`/`existeLojaComNomeNaRede`.
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
 * `deleteRedeIfNoLojas`/`deleteLojaIfNoEntradas`.
 * Retorna 'not_found' | 'has_redes' | 'deleted'.
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
  listRedesComLojas,
  listCategorias,
  getRedeComLojasById,
  insertRede,
  findRedeById,
  updateRede,
  existeRedeComNome,
  deleteRedeIfNoLojas,
  insertLoja,
  findLojaById,
  updateLoja,
  existeLojaComNomeNaRede,
  deleteLojaIfNoEntradas,
  existeResponsavel,
  listResponsaveis,
  existeResponsavelComNome,
  insertResponsavel,
  deleteResponsavelIfNoRedes,
};
