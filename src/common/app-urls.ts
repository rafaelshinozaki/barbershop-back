// Endereços que vão nos e-mails. Antes alguns estavam escritos no código
// (https://app.barbershop.com/...), um domínio que não é o do app.

/** Link do app (FRONTEND_URL) com o caminho dado */
export function appUrl(path = '/'): string {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** E-mail de suporte mostrado nos e-mails (SUPPORT_EMAIL) */
export function supportEmail(): string {
  return process.env.SUPPORT_EMAIL || 'suporte@barbershop.com.br';
}
