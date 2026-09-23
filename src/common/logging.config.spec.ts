import { maskSensitiveData } from './logging.config';

describe('maskSensitiveData', () => {
  it('esconde senha, código, token e documento em qualquer nível', () => {
    const out = maskSensitiveData({
      id: 1,
      email: 'a@b.com',
      password: '$2b$10$hash',
      idDocNumber: '12345678900',
      postalCode: '01000-000',
      input: { code: '123456', newPassword: 'x', resetToken: 't' },
      sessions: [{ refreshToken: 'r', ip: '1.1.1.1' }],
      createdAt: new Date('2030-01-01'),
    });
    expect(out).toEqual({
      id: 1,
      email: 'a@b.com',
      password: '***MASKED***',
      idDocNumber: '***MASKED***',
      postalCode: '01000-000',
      input: { code: '***MASKED***', newPassword: '***MASKED***', resetToken: '***MASKED***' },
      sessions: '***MASKED***',
      createdAt: new Date('2030-01-01'),
    });
  });
});
