import { BarbershopService } from './barbershop.service';
import { DEFAULT_WORKING_HOURS, clipToShopHours, fitsShopHours, normalizeBusinessHours, parseBusinessHours } from './working-hours';

const week = (monday: { start: string; end: string } | null = { start: '09:00', end: '18:00' }) =>
  JSON.stringify({
    sunday: null,
    monday,
    tuesday: { start: '09:00', end: '18:00' },
    wednesday: { start: '09:00', end: '18:00' },
    thursday: { start: '09:00', end: '18:00' },
    friday: { start: '09:00', end: '18:00' },
    saturday: { start: '09:00', end: '17:00' },
  });

describe('horário de funcionamento', () => {
  it('descarta o dia invertido ou fora de HH:MM e mantém o resto', () => {
    const days = parseBusinessHours(
      JSON.stringify({
        monday: { start: '18:00', end: '09:00' },
        tuesday: { start: '9h', end: '18:00' },
        wednesday: { start: '09:00', end: '18:00' },
      }),
    );
    expect(days?.[1]).toBeNull();
    expect(days?.[2]).toBeNull();
    expect(days?.[3]).toEqual({ start: '09:00', end: '18:00' });
    expect(parseBusinessHours('{')).toBeNull();
  });

  it('o cadastro recusa horário invertido e aceita a semana inteira', () => {
    expect(() => normalizeBusinessHours(week({ start: '18:00', end: '09:00' }))).toThrow(
      /monday: horário inválido/,
    );
    expect(() => normalizeBusinessHours('{"monday":{"start":"09:00","end":"18:00"}}')).toThrow(
      /7 dias/,
    );
    expect(JSON.parse(normalizeBusinessHours(week()))).toMatchObject({
      sunday: null,
      monday: { start: '09:00', end: '18:00' },
    });
  });

  it('a edição da unidade recusa horário invertido e não grava', async () => {
    const update = jest.fn();
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      ensureBarbershopAccess: async () => ({ id: 3, isActive: true, accessLevel: 'owner' }),
      prisma: { barbershop: { update } },
    });
    await expect(
      service.updateBarbershop(1, 3, {
        businessHours: week({ start: '18:00', end: '09:00' }),
      } as never),
    ).rejects.toThrow('tela de horário');
    expect(update).not.toHaveBeenCalled();
  });

  it('o cadastro com horário invertido para antes de gravar', async () => {
    const findUnique = jest.fn();
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, { prisma: { barbershop: { findUnique } } });
    await expect(
      service.createBarbershop(1, {
        businessHours: week({ start: '18:00', end: '09:00' }),
      } as never),
    ).rejects.toThrow(/monday: horário inválido/);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('o dia invertido não entra na agenda; JSON quebrado volta ao padrão', async () => {
    let businessHours = week({ start: '18:00', end: '09:00' });
    const service = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(service, {
      DEFAULT_WORKING_HOURS,
      prisma: {
        barbershop: { findUnique: async () => ({ businessHours }) },
      },
    });
    await expect(service.shopHoursOn(1, 1)).resolves.toBeNull();
    await expect(service.shopHoursOn(1, 2)).resolves.toEqual({ start: '09:00', end: '18:00' });
    businessHours = '{';
    await expect(service.shopHoursOn(1, 1)).resolves.toEqual({ start: '09:00', end: '18:00' });
  });

  it('a escala própria cabe no expediente e o horário público é cortado', () => {
    const shop = { start: '09:00', end: '18:00' };
    expect(fitsShopHours('09:00', '18:00', shop)).toBe(true);
    expect(fitsShopHours('06:00', '23:00', shop)).toBe(false);
    expect(fitsShopHours('10:00', '14:00', null)).toBe(false);
    expect(clipToShopHours({ start: '06:00', end: '23:00' }, shop)).toEqual({ start: '09:00', end: '18:00' });
    expect(clipToShopHours({ start: '19:00', end: '22:00' }, shop)).toBeNull();
  });
});
