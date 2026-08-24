const { sql, getPool } = require('../config/db');

/**
 * Acesso a dados de `MensagensTemplates`/`ConfiguracoesEnvio` — tabelas
 * novas do worker de Envio de Disparos (ver CONTRATO-CONTROLE-LIGACOES-API.md,
 * seção "Envio de Disparos (v6)"). Separado de `disparos.model.js` (dono de
 * `Disparos`/`DisparoContatos`) para não misturar as duas famílias de
 * tabela — mesmo princípio de `numerosRemetentes.model.js` ser separado de
 * `estados.model.js`.
 *
 * Schema criado por `backend/src/scripts/MIGRATION-ENVIO-DISPAROS.sql`
 * (ainda não executado — ver aviso no topo desse arquivo). Não existe hoje
 * nenhuma rota de CRUD para `MensagensTemplates`/`ConfiguracoesEnvio` — a
 * única forma de popular essas tabelas, por ora, é SQL direto (lacuna
 * conhecida, fora do escopo desta tarefa).
 */

/**
 * Todo template ativo, ordenado por `ordem` (com `id` como desempate) —
 * usado pelo worker de envio para calcular a rotação round-robin. Nunca
 * filtra/pagina: a lista de templates ativos deve ser pequena o bastante
 * para caber inteira em memória durante um ciclo do worker.
 */
async function listTemplatesAtivosOrdenados() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, corpo, ordem
    FROM MensagensTemplates
    WHERE ativo = 1
    ORDER BY ordem ASC, id ASC
  `);
  return result.recordset;
}

/**
 * `ultimo_template_usado_id` da linha única de `ConfiguracoesEnvio`.
 * Retorna `null` se a tabela estiver vazia (não deveria acontecer em
 * condições normais — a migration já garante 1 linha — mas o worker trata
 * esse caso do mesmo jeito que `ultimo_template_usado_id IS NULL`: começa a
 * rotação do primeiro template ativo, em vez de quebrar).
 */
async function getUltimoTemplateUsadoId() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (1) ultimo_template_usado_id
    FROM ConfiguracoesEnvio
  `);
  return result.recordset[0]?.ultimo_template_usado_id ?? null;
}

/**
 * Grava o id do template usado no envio bem-sucedido mais recente.
 *
 * Recebe opcionalmente uma `transaction` do `mssql` para rodar como parte de
 * uma transação maior — usada por `disparos.model.js: marcarContatoEnviado`,
 * que grava esta atualização junto com `DisparoContatos` numa única
 * transação curta (ver decisão de design no worker: a leitura que CALCULA o
 * próximo template roda fora de transação, só a gravação final do sucesso é
 * atômica). Sem `transaction`, roda direto contra o pool.
 */
async function setUltimoTemplateUsadoId(templateId, transaction) {
  const request = transaction ? new sql.Request(transaction) : (await getPool()).request();
  request.input('templateId', sql.Int, templateId);
  await request.query(`
    UPDATE TOP (1) ConfiguracoesEnvio
    SET ultimo_template_usado_id = @templateId
  `);
}

module.exports = {
  listTemplatesAtivosOrdenados,
  getUltimoTemplateUsadoId,
  setUltimoTemplateUsadoId,
};
