import { GeocodingService } from './geocoding.service';

describe('GeocodingService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.GEOCODING_DISABLED;
  });

  const address = {
    address: 'Av. Paulista, 1000',
    city: 'São Paulo',
    state: 'SP',
    country: 'BR',
    postalCode: '01310100',
  };

  it('manda o endereço estruturado e devolve as coordenadas', async () => {
    const calls: string[] = [];
    global.fetch = (async (url: string, init: RequestInit) => {
      calls.push(url);
      expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/barbershop/);
      return { ok: true, json: async () => [{ lat: '-23.5614', lon: '-46.6559' }] };
    }) as never;
    const geo = new GeocodingService({} as never);
    expect(await geo.geocode(address)).toEqual({ lat: -23.5614, lng: -46.6559 });
    expect(calls[0]).toContain('street=Av.+Paulista%2C+1000');
    expect(calls[0]).toContain('postalcode=01310100');
  });

  it('não achou ou o serviço falhou: null, sem erro', async () => {
    const geo = new GeocodingService({} as never);
    global.fetch = (async () => ({ ok: true, json: async () => [] })) as never;
    expect(await geo.geocode(address)).toBeNull();
    global.fetch = (async () => ({ ok: false, status: 503 })) as never;
    expect(await geo.geocode(address)).toBeNull();
    global.fetch = (async () => {
      throw new Error('rede fora');
    }) as never;
    expect(await geo.geocode(address)).toBeNull();
  });

  it('locate grava as coordenadas (desligado nos testes por padrão)', async () => {
    const updates: unknown[] = [];
    const prisma = {
      barbershop: {
        findUnique: async () => ({ id: 7, ...address }),
        update: async (args: unknown) => void updates.push(args),
      },
    };
    global.fetch = (async () => ({
      ok: true,
      json: async () => [{ lat: '1.5', lon: '2.5' }],
    })) as never;
    const geo = new GeocodingService(prisma as never);
    expect(await geo.locate(7)).toBe(false); // NODE_ENV=test
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      expect(await geo.locate(7)).toBe(true);
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(updates).toEqual([{ where: { id: 7 }, data: { latitude: 1.5, longitude: 2.5 } }]);
  });
});
