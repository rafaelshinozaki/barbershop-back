/** Quanto tempo a lista de unidades da conexão vale antes de ser lida de novo. */
export const SHOP_ACCESS_CACHE_MS = 15_000;

export function shopAccessStale(cachedAt: number | undefined, now: number): boolean {
  return cachedAt == null || now - cachedAt >= SHOP_ACCESS_CACHE_MS;
}
