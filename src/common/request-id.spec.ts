import { pickRequestId, requestIdMiddleware } from './request-id';

describe('id do request', () => {
  it('usa o id que veio, se tiver formato de id; senão cria um', () => {
    expect(pickRequestId('3f1c2a9e-8b7d-4c1a-9e2f-0a1b2c3d4e5f')).toBe(
      '3f1c2a9e-8b7d-4c1a-9e2f-0a1b2c3d4e5f',
    );
    expect(pickRequestId(['01HZX8K3M9Q2W7E5R4T6Y8U0IO', 'outro'])).toBe(
      '01HZX8K3M9Q2W7E5R4T6Y8U0IO',
    );
    for (const bad of [
      undefined,
      '',
      'curto',
      'tem espaço e texto livre',
      'a'.repeat(101),
      '<script>',
    ]) {
      const id = pickRequestId(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('marca o request e devolve no cabeçalho', () => {
    const req: { headers: Record<string, string>; requestId?: string } = {
      headers: { 'x-request-id': 'front-1234abcd' },
    };
    const headers: Record<string, string> = {};
    const next = jest.fn();
    requestIdMiddleware(req, { setHeader: (k: string, v: string) => (headers[k] = v) }, next);
    expect(req.requestId).toBe('front-1234abcd');
    expect(headers['x-request-id']).toBe('front-1234abcd');
    expect(next).toHaveBeenCalled();
  });
});
