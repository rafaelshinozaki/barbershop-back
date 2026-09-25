/**
 * Horário de funcionamento e escala semanal, contra o Postgres de verdade:
 * o que a tela salva é o que a página pública oferece.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ScheduleService, type BusinessDayInput } from './schedule.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function mondayAhead(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`).toISOString();

describe('Horário de funcionamento e escala (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const schedules = new ScheduleService(prisma, barbershops);
  const monday = mondayAhead();
  const sunday = addDays(monday, 6);

  let ownerId: number;
  let anaUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number;
  let beto: number;
  let serviceId: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `sch-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Teste ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
  const slots = (barberId: number, date: string) =>
    barbershops.getPublicAvailableSlots(shopId, barberId, [serviceId], date);
  const week = (over: Partial<Record<number, Omit<BusinessDayInput, 'dayOfWeek'>>>) =>
    [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      ...(over[dayOfWeek] ?? { open: true, start: '09:00', end: '18:00' }),
    }));

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    anaUserId = await createUser('ana', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Sch ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Escala',
          slug: `sch-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `sch-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    ana = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: anaUserId },
      })
    ).id;
    beto = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Beto', phone: '11922222222' },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.barberSchedule.deleteMany({ where: { barberId: { in: [ana, beto] } } });
    await prisma.barbershop.update({ where: { id: shopId }, data: { businessHours: null } });
  });

  afterAll(async () => {
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('horário da unidade: padrão até configurar; o salvo vale pra página pública', async () => {
    const before = await schedules.getBusinessHours(ownerId, shopId);
    expect(before[0]).toMatchObject({ dayOfWeek: 0, open: false, isDefault: true });
    expect(before[1]).toMatchObject({ open: true, start: '09:00', end: '18:00' });

    const saved = await schedules.setBusinessHours(
      ownerId,
      shopId,
      week({ 0: { open: true, start: '10:00', end: '14:00' }, 1: { open: false } }),
    );
    expect(saved[0]).toMatchObject({ open: true, start: '10:00', isDefault: false });
    expect(saved[1].open).toBe(false);

    expect(await slots(beto, monday)).toEqual([]);
    const sun = await slots(beto, sunday);
    expect(sun[0]).toBe(at(sunday, '10:00'));
    expect(sun[sun.length - 1]).toBe(at(sunday, '13:30'));
  });

  it('escala da profissional: próprio horário com intervalo, folga fixa e voltar pro da unidade', async () => {
    const saved = await schedules.setWeeklySchedule(ownerId, ana, [
      {
        dayOfWeek: 1,
        mode: 'CUSTOM',
        startTime: '12:00',
        endTime: '20:00',
        breakStart: '15:00',
        breakEnd: '16:00',
      },
      { dayOfWeek: 2, mode: 'OFF' },
    ]);
    expect(saved[1]).toMatchObject({
      mode: 'CUSTOM',
      startTime: '12:00',
      breakStart: '15:00',
      working: true,
    });
    expect(saved[2]).toMatchObject({ mode: 'OFF', working: false });
    expect(saved[3]).toMatchObject({ mode: 'SHOP', startTime: '09:00', working: true });

    const mon = await slots(ana, monday);
    expect(mon[0]).toBe(at(monday, '12:00'));
    expect(mon).not.toContain(at(monday, '15:00'));
    expect(mon).toContain(at(monday, '16:00'));
    expect(await slots(ana, addDays(monday, 1))).toEqual([]);

    // Volta pro horário da unidade
    await schedules.setWeeklySchedule(ownerId, ana, [{ dayOfWeek: 1, mode: 'SHOP' }]);
    expect((await slots(ana, monday))[0]).toBe(at(monday, '09:00'));
  });

  it('a profissional mexe na própria escala, não na do colega; e a validação', async () => {
    await expect(
      schedules.setWeeklySchedule(anaUserId, ana, [{ dayOfWeek: 5, mode: 'OFF' }]),
    ).resolves.toBeTruthy();
    await expect(
      schedules.setWeeklySchedule(anaUserId, beto, [{ dayOfWeek: 5, mode: 'OFF' }]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(schedules.setBusinessHours(anaUserId, shopId, week({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const bad = (days: Parameters<ScheduleService['setWeeklySchedule']>[2]) =>
      expect(schedules.setWeeklySchedule(ownerId, ana, days)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    await bad([{ dayOfWeek: 7, mode: 'OFF' }]);
    await bad([
      { dayOfWeek: 1, mode: 'OFF' },
      { dayOfWeek: 1, mode: 'SHOP' },
    ]);
    await bad([{ dayOfWeek: 1, mode: 'CUSTOM', startTime: '18:00', endTime: '09:00' }]);
    await bad([{ dayOfWeek: 1, mode: 'CUSTOM', startTime: '9h', endTime: '18:00' }]);
    await bad([
      { dayOfWeek: 1, mode: 'CUSTOM', startTime: '09:00', endTime: '18:00', breakStart: '12:00' },
    ]);
    await bad([
      {
        dayOfWeek: 1,
        mode: 'CUSTOM',
        startTime: '09:00',
        endTime: '18:00',
        breakStart: '08:00',
        breakEnd: '10:00',
      },
    ]);
    await expect(
      schedules.setBusinessHours(ownerId, shopId, week({}).slice(0, 6)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      schedules.setBusinessHours(
        ownerId,
        shopId,
        week({ 3: { open: true, start: '20:00', end: '08:00' } }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
