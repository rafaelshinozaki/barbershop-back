import { gatewayAllowed } from '../auth/guards/roles.guard';

type IpRequest = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
};

const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * IP de quem fez a requisição. O `X-Forwarded-For` que o cliente manda NÃO
 * é lido direto (ele escolheria o próprio IP): vale o `req.ip`, que o
 * Express calcula com TRUST_PROXY. Exceção: vindo da API do backoffice (com
 * o segredo x-backoffice-gateway certo), vale o x-backoffice-client-ip que
 * ela calculou; senão toda a equipe apareceria com o IP daquele serviço.
 */
export function clientIp(req: IpRequest | undefined): string {
  const secret = process.env.BACKOFFICE_GATEWAY_SECRET;
  const fromGateway = req?.headers?.['x-backoffice-client-ip'];
  if (
    secret &&
    typeof fromGateway === 'string' &&
    IP_SHAPE.test(fromGateway.trim()) &&
    gatewayAllowed(secret, req?.headers?.['x-backoffice-gateway'])
  ) {
    return fromGateway.trim();
  }
  const ip = req?.ip || req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  return (ip.startsWith('::ffff:') ? ip.slice(7) : ip) || 'unknown';
}
