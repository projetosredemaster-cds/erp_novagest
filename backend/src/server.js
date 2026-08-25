require('dotenv').config();

const app = require('./app');
const { reconciliarSessoesNoBoot } = require('./services/baileysSession.service');
const { iniciarWorkerEnvioDisparos } = require('./workers/envioDisparos.worker');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[server] API do erp_Novagest rodando na porta ${PORT}`);
});

reconciliarSessoesNoBoot().catch((err) => {
  console.error('[server] falha inesperada na reconciliação de sessões Baileys no boot:', err);
});

iniciarWorkerEnvioDisparos();
