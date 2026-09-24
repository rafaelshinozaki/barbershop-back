import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Link de descadastro dos e-mails de marketing: "<customerId>.<assinatura>".
 * A assinatura (HMAC com o segredo do servidor) impede trocar o id e
 * descadastrar outra pessoa; não precisa de login nem de tabela.
 */
function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('UNSUBSCRIBE_SECRET (ou JWT_SECRET) não configurado');
  return value;
}

function sign(customerId: number) {
  return createHmac('sha256', secret())
    .update(`marketing-unsubscribe:${customerId}`)
    .digest('base64url')
    .slice(0, 32);
}

export function createUnsubscribeToken(customerId: number): string {
  return `${customerId}.${sign(customerId)}`;
}

/** Id do cliente se o token for válido; null se não. */
export function verifyUnsubscribeToken(token: string | undefined | null): number | null {
  const match = /^(\d+)\.([A-Za-z0-9_-]{32})$/.exec((token ?? '').trim());
  if (!match) return null;
  const customerId = Number(match[1]);
  const expected = Buffer.from(sign(customerId));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? customerId : null;
}

/** Links do e-mail: página de confirmação (front) e descadastro com um clique (API). */
export function unsubscribeLinks(customerId: number) {
  const token = createUnsubscribeToken(customerId);
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  const page = `${front}/unsubscribe?t=${encodeURIComponent(token)}`;
  const api = process.env.PUBLIC_API_URL;
  // RFC 8058: o provedor (Gmail/Yahoo) faz POST nessa URL quando a pessoa
  // clica em "cancelar inscrição" — por isso ela precisa ser a da API
  const oneClick = api
    ? `${api.replace(/\/$/, '')}/marketing/unsubscribe?t=${encodeURIComponent(token)}`
    : null;
  const headers: Record<string, string> = oneClick
    ? { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : { 'List-Unsubscribe': `<${page}>` };
  return { token, page, headers };
}
