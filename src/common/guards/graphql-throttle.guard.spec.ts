import { GraphQLThrottleGuard, throttleDisabled } from './graphql-throttle.guard';

/**
 * A chave do limite de requisições é só o IP: com IP + User-Agent, trocar o
 * header a cada tentativa zerava o contador e furava todos os limites.
 */
describe('GraphQLThrottleGuard: chave do limite', () => {
  const guard = Object.create(GraphQLThrottleGuard.prototype) as GraphQLThrottleGuard;
  const tracker = (req: Record<string, any>) =>
    (guard as unknown as { getTracker(r: Record<string, any>): Promise<string> }).getTracker(req);

  it('mesmo IP com User-Agent diferente conta junto', async () => {
    const a = await tracker({ ip: '203.0.113.7', headers: { 'user-agent': 'ua-1' } });
    const b = await tracker({ ip: '203.0.113.7', headers: { 'user-agent': 'ua-2' } });
    expect(a).toBe(b);
  });

  it('não confia no X-Forwarded-For mandado pelo cliente', async () => {
    const key = await tracker({
      ip: '203.0.113.7',
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(key).toBe('203.0.113.7');
  });

  it('sem IP no req, usa o do socket', async () => {
    expect(await tracker({ socket: { remoteAddress: '192.0.2.5' } })).toBe('192.0.2.5');
  });
});

describe('THROTTLE_DISABLED (só pra testes)', () => {
  it('desliga fora de produção e é ignorada em produção', () => {
    expect(throttleDisabled({ THROTTLE_DISABLED: 'true', NODE_ENV: 'test' })).toBe(true);
    expect(throttleDisabled({ THROTTLE_DISABLED: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(throttleDisabled({})).toBe(false);
  });
});
