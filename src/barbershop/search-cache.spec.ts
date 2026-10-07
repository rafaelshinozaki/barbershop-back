import { repositionResults, searchCacheKey, SearchCacheService } from './search-cache.service';
import { withEnqueueTimeout } from '../queue/notification-queue.service';
import { haversineKm } from './search';

const km = (a: number, b: number, c: number, d: number) =>
  Math.round(haversineKm(a, b, c, d) * 10) / 10;

const shop = (name: string, lat: number, lng: number, extra: object = {}) => ({
  name,
  distanceKm: null as number | null,
  averageRating: null,
  reviewCount: 0,
  minPrice: null,
  isFeatured: false,
  points: [[lat, lng]],
  ...extra,
});

describe('cache da busca pública', () => {
  it('quem está perto divide a chave; filtro diferente não', () => {
    const a = searchCacheKey('barbershops', { lat: -23.18012, lng: -45.88731, category: 'HAIR' });
    const b = searchCacheKey('barbershops', { lat: -23.17988, lng: -45.8869, category: 'HAIR' });
    const c = searchCacheKey('barbershops', { lat: -23.18012, lng: -45.88731, category: 'NAILS' });
    const d = searchCacheKey('barbershops', { city: ' São José ', lat: null });
    const e = searchCacheKey('barbershops', { city: 'são josé' });
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(c.key);
    expect(d.key).toBe(e.key);
    expect(a.rounded).toMatchObject({ lat: -23.18, lng: -45.89 });
    // O banco busca 1 km a mais (o ponto arredondado se afasta do exato)
    expect(
      searchCacheKey('barbershops', { lat: -23.18, lng: -45.88, radiusKm: 10 }).rounded,
    ).toMatchObject({ radiusKm: 11 });
    expect(searchCacheKey('professionals', { city: 'x' }).key).not.toBe(
      searchCacheKey('barbershops', { city: 'x' }).key,
    );
  });

  it('distância refeita com o ponto exato, raio conferido e ordem por distância', () => {
    const list = [
      shop('Longe', -23.3, -45.9),
      shop('Perto', -23.181, -45.888),
      shop('Fora do raio', -24.5, -45.9),
      { ...shop('Sem posição', 0, 0), points: [] },
    ];
    const out = repositionResults(list, { lat: -23.18, lng: -45.887, radiusKm: 25 });
    expect(out.map((r) => r.name)).toEqual(['Perto', 'Longe']);
    expect(out[0].distanceKm).toBe(km(-23.18, -45.887, -23.181, -45.888));
    // Sem ponto: a lista vem como está
    expect(repositionResults(list, {})).toBe(list);
  });

  it('a unidade em destaque continua no topo da relevância', () => {
    const list = [
      shop('Perto', -23.181, -45.888),
      shop('Destaque', -23.3, -45.9, { isFeatured: true }),
    ];
    expect(repositionResults(list, { lat: -23.18, lng: -45.887 }).map((r) => r.name)).toEqual([
      'Destaque',
      'Perto',
    ]);
  });

  it('segunda busca vem do cache; Redis fora vai direto ao banco', async () => {
    const store = new Map<string, unknown>();
    const redis = {
      getJson: jest.fn(async (k: string) => store.get(k) ?? null),
      setJson: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
    };
    const cache = new SearchCacheService(redis as never);
    const compute = jest.fn(async () => [shop('Perto', -23.181, -45.888)]);
    await cache.cached('barbershops', { lat: -23.18012, lng: -45.88731 }, compute);
    const second = await cache.cached('barbershops', { lat: -23.1849, lng: -45.8851 }, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    // O banco recebeu a posição arredondada
    expect(compute).toHaveBeenCalledWith(expect.objectContaining({ lat: -23.18, lng: -45.89 }));
    // Distância do ponto exato de quem pediu, não do arredondado
    expect(second[0].distanceKm).toBe(km(-23.1849, -45.8851, -23.181, -45.888));
    expect(second[0].distanceKm).not.toBe(km(-23.18, -45.89, -23.181, -45.888));

    const down = new SearchCacheService({
      getJson: jest.fn().mockRejectedValue(new Error('Connection is closed')),
      setJson: jest.fn().mockRejectedValue(new Error('Connection is closed')),
    } as never);
    await expect(down.cached('barbershops', { city: 'x' }, compute)).resolves.toHaveLength(1);
  });
});

describe('cache da busca: Destaque vale na hora', () => {
  const fakeRedis = () => {
    const store = new Map<string, unknown>();
    return {
      getJson: jest.fn(async (k: string) => store.get(k) ?? null),
      setJson: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
      client: {
        get: jest.fn(async (k: string) => (store.has(k) ? String(store.get(k)) : null)),
        incr: jest.fn(async (k: string) => {
          const n = Number(store.get(k) ?? 0) + 1;
          store.set(k, n);
          return n;
        }),
      },
    };
  };

  it('depois do bump a busca vai ao banco de novo', async () => {
    const cache = new SearchCacheService(fakeRedis() as never);
    const compute = jest
      .fn()
      .mockResolvedValueOnce([shop('Antes', -23.181, -45.888, { isFeatured: true })])
      .mockResolvedValueOnce([shop('Depois', -23.181, -45.888)]);
    const input = { city: 'x' };
    await cache.cached('barbershops', input, compute);
    expect((await cache.cached('barbershops', input, compute))[0].name).toBe('Antes');
    await cache.bump();
    const fresh = await cache.cached('barbershops', input, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(fresh[0]).toMatchObject({ name: 'Depois', isFeatured: false });
  });

  it('bump com o Redis fora não derruba quem mudou o Destaque', async () => {
    const redis = fakeRedis();
    redis.client.incr.mockRejectedValue(new Error('Connection is closed'));
    await expect(new SearchCacheService(redis as never).bump()).resolves.toBeUndefined();
  });
});

describe('fila com o Redis fora', () => {
  it('a requisição não espera mais que o limite', async () => {
    const onTimeout = jest.fn();
    const never = new Promise<string>(() => undefined);
    const started = Date.now();
    await expect(withEnqueueTimeout(never, 50, onTimeout)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(onTimeout).toHaveBeenCalled();
  });

  it('com a fila no ar, devolve o job; erro de verdade sobe', async () => {
    const onTimeout = jest.fn();
    await expect(withEnqueueTimeout(Promise.resolve('job'), 50, onTimeout)).resolves.toBe('job');
    await expect(
      withEnqueueTimeout(Promise.reject(new Error('dados inválidos')), 50, onTimeout),
    ).rejects.toThrow('dados inválidos');
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
