import { JwtService } from '@nestjs/jwt';
import {
  REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  renewIfStale,
  setAuthCookie,
} from './session-cookie';

const jwt = new JwtService({ secret: 'segredo-de-teste' });
const fakeRes = () => {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  return {
    cookies,
    cookie: (name: string, value: string, options: Record<string, unknown>) =>
      void cookies.push({ name, value, options }),
  };
};
const payload = { userId: 1, email: 'a@b.c', sessionToken: 'sess-1' };

describe('sessão do painel ("Lembrar de mim")', () => {
  it('lembrar: token de 30 dias e cookie que sobrevive a fechar o navegador', () => {
    const res = fakeRes();
    setAuthCookie(jwt, res as never, { ...payload, remember: true }, true);
    const { value, options } = res.cookies[0];
    const decoded = jwt.decode(value) as { exp: number; iat: number; remember: boolean };
    expect(decoded.remember).toBe(true);
    expect(decoded.exp - decoded.iat).toBe(REMEMBER_TTL_SECONDS);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none' });
    expect((options.expires as Date).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it('sem lembrar: 12 horas e cookie de sessão (sem expires)', () => {
    const res = fakeRes();
    setAuthCookie(jwt, res as never, payload, false);
    const { value, options } = res.cookies[0];
    const decoded = jwt.decode(value) as { exp: number; iat: number; remember: boolean };
    expect(decoded.remember).toBe(false);
    expect(decoded.exp - decoded.iat).toBe(SESSION_TTL_SECONDS);
    expect(options.expires).toBeUndefined();
    expect(options).toMatchObject({ secure: false, sameSite: 'lax' });
  });

  it('renova só token "velho", mantendo a sessão e o lembrar', () => {
    const now = Date.now();
    const iat = Math.floor(now / 1000);
    const res = fakeRes();
    expect(
      renewIfStale(jwt, res as never, { ...payload, remember: true, iat: iat - 3600 }, false, now),
    ).toBe(false);
    expect(
      renewIfStale(jwt, res as never, { ...payload, remember: false, iat: iat - 1800 }, false, now),
    ).toBe(false);
    expect(res.cookies).toHaveLength(0);

    expect(
      renewIfStale(
        jwt,
        res as never,
        { ...payload, remember: true, iat: iat - 2 * 86400 },
        false,
        now,
      ),
    ).toBe(true);
    expect(renewIfStale(jwt, res as never, { ...payload, iat: iat - 2 * 3600 }, false, now)).toBe(
      true,
    );
    const [lembrado, sessao] = res.cookies.map((c) => ({
      ...(jwt.decode(c.value) as { sessionToken: string; remember: boolean }),
      expires: c.options.expires,
    }));
    expect(lembrado).toMatchObject({ sessionToken: 'sess-1', remember: true });
    expect(lembrado.expires).toBeInstanceOf(Date);
    expect(sessao).toMatchObject({ sessionToken: 'sess-1', remember: false });
    expect(sessao.expires).toBeUndefined();
    // Sem resposta (ex.: websocket) não faz nada
    expect(renewIfStale(jwt, undefined, { ...payload, iat: 0 }, false, now)).toBe(false);
  });
});
