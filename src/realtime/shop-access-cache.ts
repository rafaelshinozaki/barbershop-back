/** Quanto tempo a lista de unidades da conexão vale antes de ser lida de novo. */
export const SHOP_ACCESS_CACHE_MS = 15_000;

export function shopAccessStale(cachedAt: number | undefined, now: number): boolean {
  return cachedAt == null || now - cachedAt >= SHOP_ACCESS_CACHE_MS;
}

/**
 * Sessão de uma assinatura aberta (item 269): o token não venceu, a sessão
 * ainda existe e a conta está ativa. Conferido no filtro de cada aviso, com o
 * mesmo cache curto da lista de unidades.
 */
export type SessionCheck = {
  sessionToken?: string;
  /** exp do token, em segundos */
  sessionExpiresAt?: number;
  sessionOk?: boolean;
  sessionCheckedAt?: number;
};

export async function subscriptionSessionValid(
  context: SessionCheck & { userId?: number },
  load: (sessionToken: string) => Promise<{ userId: number; active: boolean } | null>,
  now = Date.now(),
): Promise<boolean> {
  if (context.sessionExpiresAt != null && context.sessionExpiresAt * 1000 <= now) return false;
  // Equipe da plataforma (API do backoffice) não tem sessão daqui
  if (!context.sessionToken) return true;
  if (context.sessionOk != null && !shopAccessStale(context.sessionCheckedAt, now)) {
    return context.sessionOk;
  }
  const session = await load(context.sessionToken);
  context.sessionOk = !!session && session.active && session.userId === context.userId;
  context.sessionCheckedAt = now;
  return context.sessionOk;
}
