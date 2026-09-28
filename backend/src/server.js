require('dotenv').config();

const app = require('./app');
const { reconciliarSessoesNoBoot } = require('./services/baileysSession.service');
const { iniciarWorkerEnvioDisparos } = require('./workers/envioDisparos.worker');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[server] API do erp_Novagest rodando na porta ${PORT}`);
});

// Default ativo quando ausente — só desliga com o valor literal 'false'.
if (process.env.CONTROLE_LIGACOES_ATIVO !== 'false') {
  reconciliarSessoesNoBoot().catch((err) => {
    console.error('[server] falha inesperada na reconciliação de sessões Baileys no boot:', err);
  });

  iniciarWorkerEnvioDisparos();
} else {
  console.log('[server] CONTROLE_LIGACOES_ATIVO=false — reconciliação de sessões Baileys e worker de envio de disparos NÃO foram iniciados.');
}
