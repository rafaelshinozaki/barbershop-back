import { ConfigService } from '@nestjs/config';
import { IpLocationService } from './ip-location.service';

describe('IpLocationService.lookup', () => {
  const make = () => new IpLocationService({ get: () => 'test' } as unknown as ConfigService);

  // Sem o setInterval de limpeza do cache (deixaria o Jest pendurado)
  beforeAll(() =>
    jest
      .spyOn(IpLocationService.prototype as any, 'scheduleCacheCleanup')
      .mockImplementation(() => undefined),
  );

  it('IP local: rede local, sem coordenadas', async () => {
    await expect(make().lookup('::1')).resolves.toEqual({
      location: 'Local Network',
      latitude: null,
      longitude: null,
    });
  });

  it('IP público: cidade e coordenadas aproximadas', async () => {
    const svc = make();
    jest.spyOn(svc as any, 'fetchLocationData').mockResolvedValue({
      city: 'São Paulo',
      region: 'SP',
      country_name: 'Brazil',
      latitude: -23.55,
      longitude: -46.63,
    });
    await expect(svc.lookup('200.1.2.3')).resolves.toEqual({
      location: 'São Paulo, SP, Brazil',
      latitude: -23.55,
      longitude: -46.63,
    });
    await expect(svc.getLocation('200.1.2.3')).resolves.toBe('São Paulo, SP, Brazil');
  });

  it('serviço fora: "Unknown" sem coordenadas', async () => {
    const svc = make();
    jest.spyOn(svc as any, 'fetchLocationData').mockRejectedValue(new Error('timeout'));
    await expect(svc.lookup('200.1.2.4')).resolves.toEqual({
      location: 'Unknown',
      latitude: null,
      longitude: null,
    });
  });
});
