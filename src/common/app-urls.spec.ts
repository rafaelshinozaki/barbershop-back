import { appUrl, safeAppLink, supportEmail } from './app-urls';

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

  it('safeAppLink: só caminho do app ou https do próprio app', () => {
    process.env.FRONTEND_URL = 'https://app.exemplo.com';
    expect(safeAppLink('/dashboard?x=1')).toBe('/dashboard?x=1');
    expect(safeAppLink('https://app.exemplo.com/plans')).toBe('https://app.exemplo.com/plans');
    expect(safeAppLink('//malicioso.com/login')).toBeNull();
    expect(safeAppLink('/\\malicioso.com')).toBeNull();
    expect(safeAppLink('javascript:alert(1)')).toBeNull();
    expect(safeAppLink('https://malicioso.com/login')).toBeNull();
    expect(safeAppLink('http://app.exemplo.com/plans')).toBeNull();
    expect(safeAppLink('')).toBeNull();
  });
});
