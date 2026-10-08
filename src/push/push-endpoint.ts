import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Serviços de push de navegador. Qualquer outro host (inclusive IP literal)
 * é recusado: o endpoint é chamado pelo servidor, então um https:// interno
 * seria um pedido para a rede da aplicação.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

export function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return PUSH_HOSTS.some((re) => re.test(host));
}

/** IP que não pode receber o POST do push (loopback, rede privada, link-local, multicast). */
export function isBlockedPushAddress(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    if (mapped.includes('.')) return isBlockedPushAddress(mapped);
  }
  if (isIP(lower) === 4) return ipv4Blocked(lower);
  if (isIP(lower) !== 6) return true;
  if (lower === '::1' || lower === '::') return true;
  const head = lower.split(':').find((part) => part.length > 0) ?? '';
  if (head.startsWith('fc') || head.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(head)) return true;
  if (head.startsWith('ff')) return true;
  return false;
}

function ipv4Blocked(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Host na lista e, depois do DNS, nenhum endereço privado. `resolve`
 * existe para o teste simular um host permitido que aponta para a rede interna.
 */
export async function assertPushEndpoint(
  endpoint: string,
  resolve: (hostname: string) => Promise<string[]> = resolvePushHost,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid');
  if (url.port && url.port !== '443') throw new Error('invalid');
  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!isAllowedPushHost(host)) throw new Error('invalid');
  const ips = isIP(host) ? [host] : await resolve(host);
  if (!ips.length || ips.some((ip) => isBlockedPushAddress(ip))) throw new Error('invalid');
}

async function resolvePushHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
