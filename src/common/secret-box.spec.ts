import { isSealed, openSecret, sealSecret } from './secret-box';

describe('secret-box', () => {
  const secret = 'chave-de-teste';

  it('guarda cifrado e abre o mesmo texto', () => {
    const sealed = sealSecret('page-token', secret);
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('page-token');
    expect(openSecret(sealed, secret)).toBe('page-token');
  });

  it('ainda lê o token antigo em texto puro', () => {
    expect(openSecret('token-antigo', secret)).toBe('token-antigo');
  });
});
