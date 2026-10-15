import { currencyForCountry, timezoneForPlace } from './place-locale';

describe('place-locale', () => {
  it('moeda pelo país, inclusive pelo nome em português', () => {
    expect(currencyForCountry('PT')).toBe('EUR');
    expect(currencyForCountry('MX')).toBe('MXN');
    expect(currencyForCountry('Brasil')).toBe('BRL');
    expect(currencyForCountry('')).toBe('BRL');
  });

  it('fuso do navegador quando ele é do país', () => {
    expect(timezoneForPlace('PT', '11', 'Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(timezoneForPlace('MX', 'JAL', 'America/Mexico_City')).toBe('America/Mexico_City');
  });

  it('ignora o fuso de São Paulo numa unidade de Portugal e usa o estado', () => {
    expect(timezoneForPlace('PT', '11', 'America/Sao_Paulo')).toBe('Europe/Lisbon');
    expect(timezoneForPlace('PT', '20', null)).toBe('Atlantic/Azores');
    expect(timezoneForPlace('PT', '30', undefined)).toBe('Atlantic/Madeira');
  });

  it('estado escolhe o fuso quando o país tem vários', () => {
    expect(timezoneForPlace('BR', 'AM', null)).toBe('America/Manaus');
    expect(timezoneForPlace('BR', 'SP', null)).toBe('America/Sao_Paulo');
    expect(timezoneForPlace('US', 'CA', null)).toBe('America/Los_Angeles');
    expect(timezoneForPlace('MX', 'BCN', null)).toBe('America/Tijuana');
  });
});
