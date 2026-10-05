import { clientClaims, staffClaims, staffSessionToken } from './session-claims';

describe('tipo de sessão pelo token', () => {
  it('equipe: userId inteiro e sessionToken; cliente e state do OAuth não valem', () => {
    expect(staffClaims({ userId: 7, sessionToken: 's', email: 'a@b' })).toEqual({
      userId: 7,
      sessionToken: 's',
    });
    // Cookie do cliente (era aceito como equipe e virava o usuário 1)
    expect(staffClaims({ clientAccountId: 1, email: 'c@d', v: 0 })).toBeNull();
    // State do OAuth das redes sociais (tem userId, mas não é sessão)
    expect(staffClaims({ barbershopId: 3, userId: 7 })).toBeNull();
    expect(staffClaims({ userId: '7', sessionToken: 's' })).toBeNull();
    expect(staffClaims({ userId: 0, sessionToken: 's' })).toBeNull();
    expect(staffClaims({ userId: 7, sessionToken: 's', clientAccountId: 1 })).toBeNull();
    expect(staffClaims(null)).toBeNull();
  });

  it('cliente: clientAccountId inteiro; o token da equipe não vale', () => {
    expect(clientClaims({ clientAccountId: 4, v: 2 })).toEqual({ clientAccountId: 4, v: 2 });
    expect(clientClaims({ clientAccountId: 4 })).toEqual({ clientAccountId: 4, v: 0 });
    expect(clientClaims({ userId: 1, sessionToken: 's' })).toBeNull();
    expect(clientClaims({ clientAccountId: 4, userId: 1 })).toBeNull();
    expect(clientClaims({ barbershopId: 3 })).toBeNull();
  });

  it('cookie da equipe só pelo nome exato', () => {
    expect(staffSessionToken({ cookies: { ClientAuthentication: 'cli' } })).toBeUndefined();
    expect(
      staffSessionToken({
        cookies: { ClientAuthentication: 'cli' },
        headers: { cookie: 'ClientAuthentication=cli' },
      }),
    ).toBeUndefined();
    expect(staffSessionToken({ cookies: { Authentication: 'staff' } })).toBe('staff');
    expect(staffSessionToken({ headers: { authorization: 'Bearer abc' } })).toBe('abc');
    expect(staffSessionToken({ cookies: { token: 'x', access_token: 'y' } })).toBeUndefined();
    // WebSocket (sem cookie-parser): cabeçalho cru, pelo nome exato
    expect(
      staffSessionToken({ headers: { cookie: 'ClientAuthentication=cli; Authentication=staff' } }),
    ).toBe('staff');
    expect(staffSessionToken({ headers: { cookie: 'ClientAuthentication=cli' } })).toBeUndefined();
  });
});
