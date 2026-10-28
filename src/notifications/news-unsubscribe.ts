import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Descadastro dos e-mails de novidades da equipe da plataforma (e-mail em
 * massa do backoffice, item 487): "<userId>.<assinatura>". Como o do
 * marketing do cliente: a assinatura impede trocar o id; sem login nem tabela.
 * O descadastro desliga a preferência "Novidades por e-mail" da conta.
 */
function secret() {
  const value = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('UNSUBSCRIBE_SECRET (ou JWT_SECRET) não configurado');
  return value;
}

function sign(userId: number) {
  return createHmac('sha256', secret())
    .update(`staff-news-unsubscribe:${userId}`)
    .digest('base64url')
    .slice(0, 32);
}

export function createNewsUnsubscribeToken(userId: number): string {
  return `${userId}.${sign(userId)}`;
}

/** Id da conta se o token for válido; null se não. */
export function verifyNewsUnsubscribeToken(token: string | undefined | null): number | null {
  const match = /^(\d+)\.([A-Za-z0-9_-]{32})$/.exec((token ?? '').trim());
  if (!match) return null;
  const userId = Number(match[1]);
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

/**
 * Link do e-mail (abre uma página com o botão de confirmar) e os cabeçalhos
 * de descadastro com um clique (RFC 8058, o Gmail e o Yahoo fazem POST). Sem
 * PUBLIC_API_URL não há para onde apontar: sai sem link.
 */
export function newsUnsubscribeLinks(userId: number) {
  const api = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
  if (!api) return { url: null, headers: undefined };
  const url = `${api}/notifications/unsubscribe-news?t=${encodeURIComponent(
    createNewsUnsubscribeToken(userId),
  )}`;
  return {
    url,
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}
