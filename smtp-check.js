// smtp-check.js
const nodemailer = require('nodemailer');

(async () => {
  const host = process.env.EMAIL_HOST;         // "mail.relable.org"
  const port = parseInt(process.env.EMAIL_PORT, 10); // 587
  const secure = process.env.EMAIL_SECURE === 'true'; // false
  const user = process.env.EMAIL_USER;         // "api@relable.org"
  const pass = process.env.EMAIL_PASS;         // "mg-&Q$;6!SoB"

  console.log('Tentando conectar a SMTP:', { host, port, secure, user });

  let transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false, // ignora mismatch do certificado
    },
    connectionTimeout: 10000, // 10 segundos
  });

  try {
    await transporter.verify();
    console.log('✅ Verificação SMTP OK – credenciais e STARTTLS em 587 aceitas.');
  } catch (err) {
    console.error('❌ Erro na verificação SMTP:', err);
  } finally {
    process.exit(0);
  }
})();
