require('dotenv').config();

const app = require('./app');
const { reconciliarSessoesNoBoot } = require('./services/baileysSession.service');
const { iniciarWorkerEnvioDisparos } = require('./workers/envioDisparos.worker');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[server] API do erp_Novagest rodando na porta ${PORT}`);
});

// Dispara em paralelo ao boot, sem bloquear o `app.listen` acima (pode levar
// vários segundos por número remetente que precise ser restaurado). Nunca
// deve derrubar o processo — qualquer rejeição é só logada.
reconciliarSessoesNoBoot().catch((err) => {
  console.error('[server] falha inesperada na reconciliação de sessões Baileys no boot:', err);
});

// Worker de Envio de Disparos: inicia o setInterval dentro do próprio
// processo backend, sem processo/fila separados (ver
// backend/src/workers/envioDisparos.worker.js). `iniciarWorkerEnvioDisparos`
// nunca rejeita/lança — não precisa de tratamento de erro aqui.
iniciarWorkerEnvioDisparos();
