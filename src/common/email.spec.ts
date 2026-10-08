import { normalizeEmail } from './email';

describe('normalizeEmail', () => {
  it('tira espaço e maiúscula', () => {
    expect(normalizeEmail('  Fulano@X.com ')).toBe('fulano@x.com');
    expect(normalizeEmail(null)).toBe('');
  });
});
