import { clientIp } from './client-ip';

describe('clientIp', () => {
  const before = process.env.BACKOFFICE_GATEWAY_SECRET;
  afterEach(() => {
    if (before === undefined) delete process.env.BACKOFFICE_GATEWAY_SECRET;
    else process.env.BACKOFFICE_GATEWAY_SECRET = before;
  });

  it('o X-Forwarded-For do cliente não escolhe o IP', () => {
    expect(clientIp({ ip: '10.0.0.5', headers: { 'x-forwarded-for': '6.6.6.6' } })).toBe(
      '10.0.0.5',
    );
    expect(clientIp({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} })).toBe(
      '127.0.0.1',
    );
    expect(clientIp(undefined)).toBe('unknown');
  });

  it('pela API do backoffice, só com o segredo certo, vale o IP que ela calculou', () => {
    process.env.BACKOFFICE_GATEWAY_SECRET = 's3cr3t';
    const headers = { 'x-backoffice-client-ip': '203.0.113.9' };
    expect(
      clientIp({ ip: '10.0.0.2', headers: { ...headers, 'x-backoffice-gateway': 's3cr3t' } }),
    ).toBe('203.0.113.9');
    // Segredo errado ou ausente: o header é ignorado
    expect(clientIp({ ip: '10.0.0.2', headers: { ...headers, 'x-backoffice-gateway': 'x' } })).toBe(
      '10.0.0.2',
    );
    expect(clientIp({ ip: '10.0.0.2', headers })).toBe('10.0.0.2');
    // Valor que não parece IP também
    expect(
      clientIp({
        ip: '10.0.0.2',
        headers: { 'x-backoffice-client-ip': 'drop table', 'x-backoffice-gateway': 's3cr3t' },
      }),
    ).toBe('10.0.0.2');
  });

  it('sem segredo configurado no back, o header nunca vale', () => {
    delete process.env.BACKOFFICE_GATEWAY_SECRET;
    expect(
      clientIp({
        ip: '10.0.0.2',
        headers: { 'x-backoffice-client-ip': '203.0.113.9', 'x-backoffice-gateway': '' },
      }),
    ).toBe('10.0.0.2');
  });
});
