import { SHOP_ACCESS_CACHE_MS, shopAccessStale } from './shop-access-cache';

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
