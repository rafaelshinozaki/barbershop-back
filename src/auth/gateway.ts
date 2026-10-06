import { timingSafeEqual } from 'crypto';

/**
 * O pedido veio da API do backoffice? (segredo x-backoffice-gateway certo).
 * Sem BACKOFFICE_GATEWAY_SECRET configurado (dev, testes), qualquer um passa.
 */
export function gatewayAllowed(
  secret: string | undefined,
  header: string | string[] | undefined,
): boolean {
  if (!secret) return true;
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
