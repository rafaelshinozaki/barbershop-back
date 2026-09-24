/**
 * Feriados e fechamentos, contra o Postgres de verdade: a página pública
 * para de oferecer (e de aceitar) o dia fechado, horário especial limita ou
 * abre o dia, e os agendamentos afetados podem ser cancelados com aviso.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { ClosureService } from './closure.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// Segunda-feira daqui a pelo menos uma semana (expediente padrão 09–18)
function mondayAhead(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7) + 7);
  return d.toISOString().slice(0, 10);
}
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);

describe('Feriados e fechamentos (integração)', () => {
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
  const closures = new ClosureService(prisma, barbershops);

  const monday = mondayAhead();
  const sunday = addDays(monday, 6);
  let ownerId: number;
  let staffUserId: number;
  let networkId: number;
  let shopId: number;
  let ana: number;
  let beto: number;
  let serviceId: number;
  let n = 0;

  const createUser = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `clo-${label}-${RUN}@test.local`,
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
  const slots = (barberId: number | null, date: string) =>
    barbershops.getPublicAvailableSlots(shopId, barberId, [serviceId], date);
  const book = (
    barberId: number,
    startAt: Date,
    email: string | null = `c${++n}-${RUN}@test.local`,
  ) =>
    barbershops.createPublicAppointment({
      barbershopId: shopId,
      barberId,
      serviceIds: [serviceId],
      startAt: startAt.toISOString(),
      customerName: 'Cliente Feriado',
      customerPhone: `8${RUN.slice(-9)}${++n}`,
      customerEmail: email ?? undefined,
    });

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await createUser('owner', roleId);
    staffUserId = await createUser('staff', roleId);
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Clo ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Feriado',
          slug: `clo-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `clo-${RUN}@test.local`,
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
  });

  afterEach(async () => {
    emails.length = 0;
    await prisma.barbershopClosure.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barberSchedule.deleteMany({ where: { barberId: { in: [ana, beto] } } });
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

  it('dia fechado: sem horários, não aceita agendar e o próximo horário pula pro dia seguinte', async () => {
    expect((await slots(null, monday)).length).toBeGreaterThan(0);
    await closures.set(ownerId, shopId, { date: monday, reason: 'Feriado municipal' });

    expect(await slots(null, monday)).toEqual([]);
    expect(await slots(ana, monday)).toEqual([]);
    await expect(book(ana, at(monday, '10:00'))).rejects.toBeInstanceOf(BadRequestException);
    const next = await barbershops.getPublicNextAvailableSlot(shopId, ana, [serviceId], monday);
    expect(next!.date).toBe(addDays(monday, 1));

    // Página pública mostra o fechamento
    const upcoming = await closures.upcomingPublic(shopId, 'America/Sao_Paulo', 30);
    expect(upcoming).toContainEqual(
      expect.objectContaining({ date: monday, openTime: null, reason: 'Feriado municipal' }),
    );

    // Tirou o fechamento: volta a abrir
    await closures.remove(ownerId, shopId, monday);
    expect((await slots(ana, monday)).length).toBeGreaterThan(0);
  });

  it('horário especial limita o dia; num dia normalmente fechado abre pra quem não tem folga marcada', async () => {
    await closures.set(ownerId, shopId, { date: monday, openTime: '10:00', closeTime: '12:00' });
    const list = await slots(ana, monday);
    expect(list[0]).toBe(at(monday, '10:00').toISOString());
    expect(list[list.length - 1]).toBe(at(monday, '11:30').toISOString());
    await expect(book(ana, at(monday, '14:00'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(book(ana, at(monday, '10:30'))).resolves.toBeTruthy();

    // Domingo (fechado no padrão): abre 09–13; Beto tem folga marcada no domingo
    expect(await slots(ana, sunday)).toEqual([]);
    await prisma.barberSchedule.create({
      data: { barberId: beto, dayOfWeek: 0, startTime: '09:00', endTime: '18:00', isActive: false },
    });
    await closures.set(ownerId, shopId, { date: sunday, openTime: '09:00', closeTime: '13:00' });
    expect(await slots(ana, sunday)).toContain(at(sunday, '09:00').toISOString());
    expect(await slots(beto, sunday)).toEqual([]);
  });

  it('mostra quem seria afetado e, se pedir, cancela avisando o cliente com o motivo', async () => {
    const morning = await book(ana, at(monday, '09:00'));
    const afternoon = await book(beto, at(monday, '15:00'));
    const noEmail = await book(beto, at(monday, '16:00'), null);
    emails.length = 0; // confirmações do agendamento

    const impact = await closures.impact(ownerId, shopId, {
      date: monday,
      openTime: '08:00',
      closeTime: '13:00',
    });
    expect(impact.map((a) => a.id)).toEqual([afternoon!.id, noEmail!.id]);
    expect(impact[1].hasEmail).toBe(false);

    const result = await closures.set(ownerId, shopId, {
      date: monday,
      openTime: '08:00',
      closeTime: '13:00',
      reason: 'Evento na rua',
      cancelAffected: true,
    });
    expect(result).toMatchObject({ affectedCount: 2, cancelledCount: 2 });
    const statuses = await prisma.appointment.findMany({
      where: { id: { in: [morning!.id, afternoon!.id, noEmail!.id] } },
      orderBy: { id: 'asc' },
      select: { status: true },
    });
    expect(statuses.map((s) => s.status)).toEqual(['CONFIRMED', 'CANCELLED', 'CANCELLED']);
    await new Promise((r) => setTimeout(r, 50));
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ template: 'appointment_cancelled' });
    expect(emails[0].context.Reason).toBe('Evento na rua');

    // Sem cancelAffected: só informa
    const again = await closures.set(ownerId, shopId, { date: monday });
    expect(again).toMatchObject({ affectedCount: 1, cancelledCount: 0 });
  });

  it('vários dias de uma vez e validações', async () => {
    const r = await closures.set(ownerId, shopId, {
      date: monday,
      endDate: addDays(monday, 4),
      reason: 'Reforma',
    });
    expect(r.dates).toHaveLength(5);
    expect((await closures.list(ownerId, shopId)).map((c) => c.date)).toEqual(r.dates);

    const bad = (input: Parameters<ClosureService['set']>[2]) =>
      expect(closures.set(ownerId, shopId, input)).rejects.toBeInstanceOf(BadRequestException);
    await bad({ date: '2020-01-01' });
    await bad({ date: 'amanhã' });
    await bad({ date: monday, endDate: addDays(monday, -1) });
    await bad({ date: monday, endDate: addDays(monday, 61) });
    await bad({ date: monday, openTime: '10:00' });
    await bad({ date: monday, openTime: '12:00', closeTime: '10:00' });
    await bad({ date: monday, openTime: '25:00', closeTime: '26:00' });
  });

  it('profissional vê os fechamentos, mas só gerente e dono cadastram', async () => {
    await closures.set(ownerId, shopId, { date: monday });
    expect(await closures.list(staffUserId, shopId)).toHaveLength(1);
    await expect(closures.set(staffUserId, shopId, { date: monday })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(closures.remove(staffUserId, shopId, monday)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
