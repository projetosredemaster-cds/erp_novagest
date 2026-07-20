/**
 * Integração com a API transacional do Brevo (https://api.brevo.com/v3/smtp/email).
 * Camada de acesso a um serviço externo, no mesmo papel que um model tem para
 * o banco — não conhece Express (req/res), só monta a chamada HTTP e propaga
 * o erro real retornado pelo Brevo para quem chamar.
 */

const BREVO_SMTP_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';

async function enviarRelatorioEmail({ assunto, texto }) {
  const apiKey = process.env.BREVO_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE;
  const remetenteNome = process.env.EMAIL_REMETENTE_NOME;
  const destinatarios = process.env.EMAIL_DESTINATARIOS;

  if (!apiKey || !remetente || !remetenteNome || !destinatarios) {
    throw new Error(
      'Variáveis de ambiente de e-mail (BREVO_API_KEY, EMAIL_REMETENTE, EMAIL_REMETENTE_NOME, EMAIL_DESTINATARIOS) não estão configuradas.'
    );
  }

  const to = destinatarios
    .split(',')
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => ({ email }));

  const payload = {
    sender: { email: remetente, name: remetenteNome },
    to,
    subject: assunto,
    textContent: texto,
  };

  // TODO(debug temporário — remover depois que o problema do remetente for confirmado resolvido)
  console.log('[brevoEmail.service] DEBUG sender enviado ao Brevo:', JSON.stringify(payload.sender));

  const response = await fetch(BREVO_SMTP_EMAIL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    console.error('[brevoEmail.service] Erro retornado pela API do Brevo:', response.status, JSON.stringify(data));

    const erro = new Error((data && data.message) || 'Erro ao enviar e-mail via Brevo.');
    erro.brevoError = true;
    erro.brevoStatus = response.status;
    erro.brevoBody = data;
    throw erro;
  }

  return response.json();
}

module.exports = { enviarRelatorioEmail };
