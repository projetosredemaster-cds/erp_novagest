const { sql, getPool } = require('../config/db');

async function listTemplatesAtivosOrdenados(tipo) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tipo', sql.VarChar(20), tipo)
    .query(`
      SELECT id, corpo, ordem
      FROM MensagensTemplates
      WHERE ativo = 1 AND tipo = @tipo
      ORDER BY ordem ASC, id ASC
    `);
  return result.recordset;
}

async function getUltimoTemplateUsadoId(tipo) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tipo', sql.VarChar(20), tipo)
    .query(`
      SELECT TOP (1) ultimo_template_usado_id
      FROM ConfiguracoesEnvio
      WHERE tipo = @tipo
    `);
  return result.recordset[0]?.ultimo_template_usado_id ?? null;
}

async function setUltimoTemplateUsadoId(templateId, tipo, transaction) {
  const request = transaction ? new sql.Request(transaction) : (await getPool()).request();
  request.input('templateId', sql.Int, templateId);
  request.input('tipo', sql.VarChar(20), tipo);
  await request.query(`
    UPDATE ConfiguracoesEnvio
    SET ultimo_template_usado_id = @templateId
    WHERE tipo = @tipo
  `);
}

module.exports = {
  listTemplatesAtivosOrdenados,
  getUltimoTemplateUsadoId,
  setUltimoTemplateUsadoId,
};
