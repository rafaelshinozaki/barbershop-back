import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { assertOAuthState, OAUTH_STATE_COOKIE, oauthStateOptions } from './oauth-state';

const context = (req: Record<string, unknown>) => {
  const cookies: Record<string, unknown> = {};
  const res = {
    cookie: (name: string, value: string) => (cookies[name] = value),
    clearCookie: (name: string) => delete cookies[name],
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, cookies };
};

describe('state do login social do cliente', () => {
  it('na ida, gera o state e guarda no cookie; na volta, igual passa', () => {
    const start = context({ path: '/client-auth/google' });
    const { state } = oauthStateOptions(start.ctx);
    expect(state).toHaveLength(32);
    expect(start.cookies[OAUTH_STATE_COOKIE]).toBe(state);

    const back = context({
      path: '/client-auth/google/redirect',
      query: { state },
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });
    expect(() => assertOAuthState(back.ctx)).not.toThrow();
    // Apple volta por POST com o state no corpo
    const apple = context({
      path: '/client-auth/apple/redirect',
      query: {},
      body: { state },
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });
    expect(() => assertOAuthState(apple.ctx)).not.toThrow();
  });

  it('link de volta montado por outra pessoa (sem cookie ou state diferente) é recusado', () => {
    for (const req of [
      { query: { state: 'x'.repeat(32) }, cookies: {} },
      { query: {}, cookies: { [OAUTH_STATE_COOKIE]: 'a'.repeat(32) } },
      { query: { state: 'b'.repeat(32) }, cookies: { [OAUTH_STATE_COOKIE]: 'a'.repeat(32) } },
    ]) {
      const { ctx } = context({ path: '/client-auth/google/redirect', ...req });
      expect(() => assertOAuthState(ctx)).toThrow(ForbiddenException);
    }
  });
});
