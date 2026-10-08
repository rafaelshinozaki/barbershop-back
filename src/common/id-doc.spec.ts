import { canonicalIdDoc, idDocLookupDigits } from './id-doc';

describe('canonicalIdDoc', () => {
  it('mascara CPF brasileiro e deixa o SSN só com dígitos', () => {
    expect(canonicalIdDoc('12345678901', 'BR')).toBe('123.456.789-01');
    expect(canonicalIdDoc('123.456.789-01', 'Brasil')).toBe('123.456.789-01');
    expect(canonicalIdDoc('123-45-6789', 'US')).toBe('123456789');
    expect(canonicalIdDoc('12345678901', 'MX')).toBe('12345678901');
  });

  it('não tira letra de passaporte', () => {
    expect(canonicalIdDoc('AB123456', 'US')).toBe('AB123456');
    expect(idDocLookupDigits('AB123456')).toBeNull();
    expect(idDocLookupDigits('123.456.789-01')).toBe('12345678901');
  });
});
