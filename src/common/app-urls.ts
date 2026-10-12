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

/**
 * Link de aviso ou e-mail que a equipe manda: só caminho do app (`/…`, sem
 * `//` nem `\\`) ou `https://` do próprio app. Qualquer outro (outro domínio,
 * `javascript:`) devolve null: um aviso "oficial" não leva pra fora.
 */
export function safeAppLink(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  if (v.startsWith('/')) return /^\/(?![/\\])/.test(v) && !/[\s\\]/.test(v) ? v : null;
  try {
    const target = new URL(v);
    const app = new URL(appUrl('/'));
    return target.protocol === 'https:' && target.host === app.host ? target.toString() : null;
  } catch {
    return null;
  }
}
