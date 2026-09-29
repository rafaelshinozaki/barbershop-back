/** Teto de conexões do Prisma por processo (padrão: CPUs × 2 + 1) */
export const DEFAULT_CONNECTION_LIMIT = 10;
/** Segundos esperando uma conexão livre antes de dar erro */
export const DEFAULT_POOL_TIMEOUT = 10;

/**
 * DATABASE_URL com teto de conexões: se a URL não diz `connection_limit` /
 * `pool_timeout`, entram os padrões. Máquina com mais núcleos não abre mais
 * conexões por isso, e vários processos (segunda instância, seed, Studio)
 * não somam o bastante pra estourar o `max_connections` do Postgres. O que
 * vem na URL sempre vale.
 */
export function withPoolLimits(url: string | undefined): string | undefined {
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.protocol.startsWith('postgres')) return url;
  if (!parsed.searchParams.has('connection_limit')) {
    parsed.searchParams.set('connection_limit', String(DEFAULT_CONNECTION_LIMIT));
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    parsed.searchParams.set('pool_timeout', String(DEFAULT_POOL_TIMEOUT));
  }
  return parsed.toString();
}
