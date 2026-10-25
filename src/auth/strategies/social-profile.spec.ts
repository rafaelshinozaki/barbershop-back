import { emailUnverified, googleEmailUnverified } from './social-profile';

describe('e-mail do provedor (item 271)', () => {
  it('recusa só quando o provedor diz que não verificou', () => {
    expect(googleEmailUnverified({ emails: [{ verified: false }] })).toBe(true);
    expect(googleEmailUnverified({ _json: { email_verified: 'false' } })).toBe(true);
    expect(googleEmailUnverified({ emails: [{ verified: true }] })).toBe(false);
    // Sem a informação (Facebook, perfil antigo): segue
    expect(googleEmailUnverified({})).toBe(false);
    expect(emailUnverified(undefined)).toBe(false);
    expect(emailUnverified('false')).toBe(true);
  });
});
