import { withPoolLimits } from './pool-url';

describe('withPoolLimits', () => {
  it('põe o teto de conexões quando a URL não diz', () => {
    const url = new URL(withPoolLimits('postgresql://u:p@db:5432/app?schema=public') as string);
    expect(url.searchParams.get('connection_limit')).toBe('10');
    expect(url.searchParams.get('pool_timeout')).toBe('10');
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.password).toBe('p');
  });

  it('o que vem na URL vale', () => {
    const url = new URL(
      withPoolLimits('postgres://u:p@db/app?connection_limit=3&pool_timeout=30') as string,
    );
    expect(url.searchParams.get('connection_limit')).toBe('3');
    expect(url.searchParams.get('pool_timeout')).toBe('30');
  });

  it('sem URL, URL inválida ou outro banco: não mexe', () => {
    expect(withPoolLimits(undefined)).toBeUndefined();
    expect(withPoolLimits('não é url')).toBe('não é url');
    expect(withPoolLimits('file:./dev.db')).toBe('file:./dev.db');
  });
});
