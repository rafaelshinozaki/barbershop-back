import { localeGroups, moneyByCurrency } from './dashboard-locale';

describe('dashboard locale', () => {
  it('agrupa unidades do mesmo fuso e da mesma moeda', () => {
    expect(
      localeGroups([
        { id: 1, timezone: 'America/Sao_Paulo', currency: 'BRL' },
        { id: 2, timezone: 'America/Sao_Paulo', currency: 'BRL' },
        { id: 3, timezone: 'Europe/Lisbon', currency: 'EUR' },
      ]),
    ).toEqual([
      { timeZone: 'America/Sao_Paulo', currency: 'BRL', ids: [1, 2] },
      { timeZone: 'Europe/Lisbon', currency: 'EUR', ids: [3] },
    ]);
  });

  it('soma cada moeda à parte', () => {
    expect(
      moneyByCurrency([
        { currency: 'EUR', amount: 5 },
        { currency: 'BRL', amount: 10 },
        { currency: 'BRL', amount: 2 },
      ]),
    ).toEqual([
      { currency: 'BRL', amount: 12 },
      { currency: 'EUR', amount: 5 },
    ]);
  });
});
