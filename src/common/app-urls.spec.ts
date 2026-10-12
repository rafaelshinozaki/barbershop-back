import { appUrl, supportEmail } from './app-urls';

describe('app-urls', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('usa o FRONTEND_URL, sem barra repetida', () => {
    process.env.FRONTEND_URL = 'https://app.exemplo.com/';
    expect(appUrl('/login')).toBe('https://app.exemplo.com/login');
    expect(appUrl('pricing')).toBe('https://app.exemplo.com/pricing');
  });

  it('e-mail de suporte vem da configuração', () => {
    process.env.SUPPORT_EMAIL = 'ajuda@exemplo.com';
    expect(supportEmail()).toBe('ajuda@exemplo.com');
  });
});
