import {
  fromMinorUnits,
  isZeroDecimal,
  moneyCap,
  moneyScale,
  roundMoney,
  toMinorUnits,
} from './money-units';

describe('money-units', () => {
  it('moeda com centavos vai × 100', () => {
    expect(toMinorUnits(12.34, 'BRL')).toBe(1234);
    expect(fromMinorUnits(1234, 'brl')).toBe(12.34);
  });

  it('moeda sem centavos vai inteira', () => {
    expect(isZeroDecimal('jpy')).toBe(true);
    expect(toMinorUnits(1000, 'JPY')).toBe(1000);
    expect(fromMinorUnits(1000, 'JPY')).toBe(1000);
    expect(toMinorUnits(15000, 'KRW')).toBe(15000);
  });

  it('arredonda no passo da moeda', () => {
    expect(roundMoney(10.005, 'USD')).toBe(10.01);
    expect(roundMoney(999.6, 'CLP')).toBe(1000);
  });

  it('teto acompanha a moeda (o mesmo fator da caixinha pelo app)', () => {
    expect(moneyScale('BRL')).toBe(1);
    expect(moneyScale('EUR')).toBe(1);
    expect(moneyScale('cop')).toBe(1000);
    expect(moneyScale('LAK')).toBe(20000);
    expect(moneyScale('BIF')).toBe(3000);
    expect(moneyCap(1_000_000, 'BRL')).toBe(1_000_000);
    expect(moneyCap(1_000_000, 'COP')).toBe(1_000_000_000);
    expect(moneyCap(1_000_000, 'IDR')).toBe(10_000_000_000);
    expect(moneyCap(10_000, 'VND')).toBe(200_000_000);
    expect(moneyCap(500, 'PYG')).toBe(2_500_000);
  });
});
