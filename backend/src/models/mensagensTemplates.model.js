const { sql, getPool } = require('../config/db');

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

async function getUltimoTemplateUsadoId() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (1) ultimo_template_usado_id
    FROM ConfiguracoesEnvio
  `);
  return result.recordset[0]?.ultimo_template_usado_id ?? null;
}

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
