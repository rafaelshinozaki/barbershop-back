import {
  SHOP_ACCESS_CACHE_MS,
  shopAccessStale,
  subscriptionSessionValid,
} from './shop-access-cache';

describe('shopAccessStale', () => {
  const now = 1_000_000;

  it('sem leitura anterior, confere de novo', () => {
    expect(shopAccessStale(undefined, now)).toBe(true);
  });

  it('dentro da janela, usa a lista da conexão', () => {
    expect(shopAccessStale(now - SHOP_ACCESS_CACHE_MS + 1, now)).toBe(false);
  });

  it('passada a janela, confere de novo', () => {
    expect(shopAccessStale(now - SHOP_ACCESS_CACHE_MS, now)).toBe(true);
  });
});

describe('assinatura em tempo real com a sessão encerrada (item 269)', () => {
  const now = 1_000_000_000_000;

  it('sessão apagada, conta desativada ou token vencido param os avisos', async () => {
    let session: { userId: number; active: boolean } | null = { userId: 7, active: true };
    const load = jest.fn(async () => session);
    const ctx: Record<string, unknown> = {
      userId: 7,
      sessionToken: 'tok',
      sessionExpiresAt: now / 1000 + 3600,
    };
    expect(await subscriptionSessionValid(ctx, load, now)).toBe(true);
    // Dentro do cache curto não relê o banco
    session = null;
    expect(await subscriptionSessionValid(ctx, load, now + 1_000)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    // Passado o cache: a sessão saiu (logout, troca de senha)
    expect(await subscriptionSessionValid(ctx, load, now + 20_000)).toBe(false);

    session = { userId: 7, active: false };
    expect(await subscriptionSessionValid({ ...ctx }, load, now)).toBe(false);

    session = { userId: 7, active: true };
    expect(
      await subscriptionSessionValid({ ...ctx, sessionExpiresAt: now / 1000 - 1 }, load, now),
    ).toBe(false);
  });
});
