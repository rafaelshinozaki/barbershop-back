/**
 * Agendamento recorrente, contra o Postgres de verdade: datas no mesmo dia
 * e hora local, conflitos pulados (e explicados antes), um e-mail só, e
 * cancelar "este e os próximos".
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { AppointmentSeriesService, type SeriesInput } from './appointment-series.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

function mondayAhead(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);
// Os e-mails saem em segundo plano: espera assentar antes de conferir/limpar
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('Agendamento recorrente (integração)', () => {
  const prisma = new PrismaService();
  const emails: any[] = [];
  const stub = {} as never;
  const barbershops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async (job: any) => void emails.push(job), whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const series = new AppointmentSeriesService(prisma, barbershops);
  const monday = mondayAhead();

  let ownerId: number;
  let staffUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number;
  let beto: number;
  let serviceId: number;
  let customerId: number;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `ser-${label}-${RUN}@test.local`,
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
  const input = (over: Partial<SeriesInput> = {}): SeriesInput => ({
    customerId,
    barberId: ana,
    startAt: at(monday, '10:00'),
    endAt: at(monday, '10:30'),
    services: [{ serviceId, unitPrice: 50 }],
    intervalWeeks: 2,
    occurrences: 4,
    ...over,
  });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    staffUserId = await createUser('staff', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Ser ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Fixa',
          slug: `ser-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `ser-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    ana = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Ana', phone: '11911111111', userId: staffUserId },
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
    customerId = (
      await prisma.customer.create({
        data: {
          networkId,
          name: 'Carlos Fixo',
          phone: `5${RUN.slice(-10)}`,
          email: `fixo-${RUN}@test.local`,
        },
      })
    ).id;
  });

  afterEach(async () => {
    emails.length = 0;
    await prisma.barberTimeOff.deleteMany({ where: { barberId: { in: [ana, beto] } } });
    await prisma.barbershopClosure.deleteMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: shopId } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
  });

  afterAll(async () => {
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('a cada 2 semanas: mesmo dia e hora; conflito, folga e dia fechado ficam de fora, explicados', async () => {
    // Semana 2: já tem horário; semana 4: folga; semana 6: unidade fechada
    await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: ana,
      startAt: at(addDays(monday, 14), '10:15'),
      endAt: at(addDays(monday, 14), '10:45'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    await prisma.barberTimeOff.create({
      data: {
        barberId: ana,
        startAt: at(addDays(monday, 28), '00:00'),
        endAt: at(addDays(monday, 29), '00:00'),
        reason: 'VACATION',
      },
    });
    await prisma.barbershopClosure.create({
      data: { barbershopId: shopId, date: addDays(monday, 42), reason: 'Feriado' },
    });
    await settle();
    emails.length = 0;

    const preview = await series.preview(ownerId, shopId, input({ occurrences: 5 }));
    expect(preview.map((p) => p.startAt.toISOString())).toEqual(
      [0, 14, 28, 42, 56].map((d) => at(addDays(monday, d), '10:00').toISOString()),
    );
    expect(preview.map((p) => p.ok)).toEqual([true, false, false, false, true]);
    expect(preview[1].reason).toMatch(/já tem um agendamento/);
    expect(preview[2].reason).toMatch(/folga/);
    expect(preview[3].reason).toBe('Unidade fechada (Feriado)');

    const result = await series.create(ownerId, shopId, input({ occurrences: 5 }));
    expect(result.createdCount).toBe(2);
    expect(result.skipped.map((s) => s.index)).toEqual([1, 2, 3]);
    const appts = await prisma.appointment.findMany({
      where: { seriesId: result.seriesId },
      orderBy: { startAt: 'asc' },
    });
    expect(appts.map((a) => a.seriesIndex)).toEqual([0, 4]);

    // Um e-mail só, com as duas datas
    await settle();
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      template: 'appointment_confirmation',
      to: `fixo-${RUN}@test.local`,
    });
    expect(emails[0].context.SeriesDates).toHaveLength(2);
  });

  it('fora do expediente avisa mas marca', async () => {
    const preview = await series.preview(
      ownerId,
      shopId,
      input({ startAt: at(monday, '19:00'), endAt: at(monday, '19:30'), occurrences: 2 }),
    );
    expect(preview.every((p) => p.ok)).toBe(true);
    expect(preview[0].warning).toMatch(/Fora do expediente/);
  });

  it('cancelar este e os próximos: os anteriores ficam; um aviso só', async () => {
    const { seriesId } = await series.create(
      ownerId,
      shopId,
      input({ intervalWeeks: 1, occurrences: 4 }),
    );
    const appts = await prisma.appointment.findMany({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });
    await settle();
    emails.length = 0;

    expect((await series.cancelFromHere(ownerId, shopId, appts[1].id)).cancelledCount).toBe(3);
    const after = await prisma.appointment.findMany({
      where: { seriesId },
      orderBy: { startAt: 'asc' },
    });
    expect(after.map((a) => a.status)).toEqual([
      'CONFIRMED',
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
    ]);
    await settle();
    expect(emails).toHaveLength(1);
    expect(emails[0].context.SeriesDates).toHaveLength(3);

    // Avulso não é série
    const single = await barbershops.createAppointment(ownerId, shopId, {
      customerId,
      barberId: beto,
      startAt: at(monday, '15:00'),
      endAt: at(monday, '15:30'),
      services: [{ serviceId, unitPrice: 50 }],
    });
    await expect(series.cancelFromHere(ownerId, shopId, single!.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('barbeira faz série na própria agenda, não na do colega; limites', async () => {
    await expect(
      series.create(staffUserId, shopId, input({ occurrences: 2 })),
    ).resolves.toBeTruthy();
    await expect(
      series.preview(staffUserId, shopId, input({ barberId: beto, occurrences: 2 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    for (const bad of [
      { occurrences: 1 },
      { occurrences: 27 },
      { intervalWeeks: 0 },
      { intervalWeeks: 9 },
    ]) {
      await expect(series.preview(ownerId, shopId, input(bad))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });
});
