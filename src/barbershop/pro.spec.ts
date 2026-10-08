import { extendProUntil, isNewProAccount, isProActive, proPriceLabel } from './pro';

describe('pro', () => {
  const now = new Date('2026-09-26T15:00:00.000Z');

  it('mostra o preço provisório', () => {
    expect(proPriceLabel()).toBe('R$ 39,90');
  });

  it('começa o mês a partir de agora quando não há Pro', () => {
    expect(extendProUntil(null, 1, now).toISOString()).toBe('2026-10-26T15:00:00.000Z');
  });

  it('empilha o mês depois do Pro que ainda vale', () => {
    const until = new Date('2026-11-01T00:00:00.000Z');
    expect(extendProUntil(until, 1, now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('conta nova é a criada nos últimos 30 dias', () => {
    expect(isNewProAccount(new Date('2026-08-27T15:00:00.000Z'), now)).toBe(true);
    expect(isNewProAccount(new Date('2026-08-27T14:59:59.000Z'), now)).toBe(false);
  });

  it('só está ativo enquanto a data não passou', () => {
    expect(isProActive(new Date('2026-09-26T15:00:01.000Z'), now)).toBe(true);
    expect(isProActive(now, now)).toBe(false);
    expect(isProActive(null, now)).toBe(false);
  });
});
