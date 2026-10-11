import { fromMinorUnits, isZeroDecimal, roundMoney, toMinorUnits } from './money-units';

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
});
