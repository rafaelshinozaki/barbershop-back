import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from '../privacy/retention.service';
import { BarbershopService } from './barbershop.service';
import { CustomerRatingService } from './customer-rating.service';

const RUN = `${Date.now()}`.slice(-9);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Nota do cliente: o profissional que atendeu e a unidade (recepção pra
 * cima) avaliam pontualidade e trato depois do atendimento concluído; a
 * média soma as fichas da mesma conta, só quem atende vê, e o cliente vê a
 * própria. Comparecimento vem do histórico.
 */
describe('Nota do cliente (integração)', () => {
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
  const emails: Array<{ userId: number; context: any; to: string }> = [];
  const ratings = new CustomerRatingService(prisma, barbershops, {
    email: async (job: any) => void emails.push(job),
  } as never);

  let roleId: number;
  const users: Record<string, number> = {};
  const networks: number[] = [];
  const shops: Record<string, number> = {};
  const barbers: Record<string, number> = {};
  let accountId: number;
  let customerA: number;
  let customerB: number;
  let n = 0;

  const user = async (label: string) =>
    (users[label] = (
      await prisma.user.create({
        data: {
          email: `cr-${label}-${RUN}@test.local`,
          password: 'x',
          fullName: `Pessoa ${label}`,
          idDocNumber: `${RUN}${label}`.slice(-20),
          phone: `+55${++n}${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id);

  const shop = async (
    label: string,
    networkId: number,
    ownerUserId: number,
    practiceKind = 'shop',
  ) =>
    (shops[label] = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade ${label}`,
          slug: `cr-${label}-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `cr-${label}-${RUN}@test.local`,
          networkId,
          ownerUserId,
          practiceKind,
        },
      })
    ).id);

  const barber = async (label: string, shopLabel: string, userId: number, staffType = 'barber') =>
    (barbers[label] = (
      await prisma.barber.create({
        data: {
          barbershopId: shops[shopLabel],
          name: label,
          phone: `119${RUN}`.slice(0, 11),
          userId,
          staffType,
        },
      })
    ).id);

  const appointment = (
    shopLabel: string,
    barberLabel: string,
    customerId: number,
    endedHoursAgo: number,
    status = 'COMPLETED',
  ) =>
    prisma.appointment.create({
      data: {
        barbershopId: shops[shopLabel],
        barberId: barbers[barberLabel],
        customerId,
        startAt: new Date(Date.now() - (endedHoursAgo + 1) * HOUR),
        endAt: new Date(Date.now() - endedHoursAgo * HOUR),
        status,
      },
    });

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    for (const label of ['dono', 'pro', 'recep', 'outro', 'dono2', 'solo']) await user(label);
    networks.push(
      (await prisma.network.create({ data: { ownerUserId: users.dono, name: `Rede CR ${RUN}` } }))
        .id,
      (await prisma.network.create({ data: { ownerUserId: users.dono2, name: `Rede CR2 ${RUN}` } }))
        .id,
      (await prisma.network.create({ data: { ownerUserId: users.solo, name: `Rede CR3 ${RUN}` } }))
        .id,
    );
    await shop('a', networks[0], users.dono);
    await shop('b', networks[1], users.dono2);
    await shop('solo', networks[2], users.solo, 'solo');
    await barber('pro', 'a', users.pro);
    await barber('recep', 'a', users.recep, 'reception');
    await barber('outro', 'a', users.outro);
    await barber('dono2', 'b', users.dono2);
    await barber('solo', 'solo', users.solo);
    accountId = (
      await prisma.clientAccount.create({
        data: { email: `cr-cliente-${RUN}@test.local`, name: 'Carla Cliente' },
      })
    ).id;
    // A mesma pessoa com ficha em duas redes (ligadas pela conta)
    customerA = (
      await prisma.customer.create({
        data: {
          networkId: networks[0],
          name: 'Carla Cliente',
          phone: `7${RUN}`,
          clientAccountId: accountId,
        },
      })
    ).id;
    customerB = (
      await prisma.customer.create({
        data: {
          networkId: networks[1],
          name: 'Carla C.',
          phone: `6${RUN}`,
          clientAccountId: accountId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: { in: Object.values(shops) } } });
    await prisma.customer.deleteMany({ where: { networkId: { in: networks } } });
    await prisma.clientAccount.deleteMany({ where: { id: accountId } });
    await prisma.network.deleteMany({ where: { id: { in: networks } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    await prisma.$disconnect();
  });

  it('quem atendeu avalia pelo profissional; recepção pra cima, pela unidade; os outros não', async () => {
    const appt = await appointment('a', 'pro', customerA, 3);

    expect(await ratings.forAppointment(users.pro, shops.a, appt.id)).toMatchObject({
      customerId: customerA,
      sides: ['professional'],
      ratings: [],
    });
    expect((await ratings.forAppointment(users.recep, shops.a, appt.id)).sides).toEqual(['unit']);
    expect((await ratings.forAppointment(users.dono, shops.a, appt.id)).sides).toEqual(['unit']);
    await expect(ratings.forAppointment(users.outro, shops.a, appt.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    await ratings.rate(users.pro, shops.a, appt.id, 'professional', 5, 4);
    await ratings.rate(users.recep, shops.a, appt.id, 'unit', 2, 3);
    // Mudar a nota atualiza a mesma
    await ratings.rate(users.pro, shops.a, appt.id, 'professional', 4, 4);
    expect(await prisma.customerRating.count({ where: { appointmentId: appt.id } })).toBe(2);

    await expect(ratings.rate(users.pro, shops.a, appt.id, 'unit', 5, 5)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      ratings.rate(users.outro, shops.a, appt.id, 'professional', 5, 5),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      ratings.rate(users.pro, shops.a, appt.id, 'professional', 6, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('só atendimento concluído e até 30 dias depois; no solo não existe o lado da unidade', async () => {
    const pending = await appointment('a', 'pro', customerA, -5, 'CONFIRMED');
    await expect(
      ratings.rate(users.pro, shops.a, pending.id, 'professional', 5, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
    const old = await appointment('a', 'pro', customerA, 31 * 24);
    await expect(
      ratings.rate(users.pro, shops.a, old.id, 'professional', 5, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await ratings.forAppointment(users.pro, shops.a, old.id)).sides).toEqual([]);

    const solo = await appointment('solo', 'solo', customerB, 3);
    expect((await ratings.forAppointment(users.solo, shops.solo, solo.id)).sides).toEqual([
      'professional',
    ]);
  });

  it('média soma as fichas da mesma conta; comparecimento vem do histórico', async () => {
    const other = await appointment('b', 'dono2', customerB, 5);
    await ratings.rate(users.dono2, shops.b, other.id, 'professional', 3, 5);
    await appointment('b', 'dono2', customerB, 48, 'NO_SHOW');

    const conduct = await ratings.myConduct(accountId);
    // pontualidade 4 (pro), 2 (unidade), 3 (outra rede); trato 4, 3, 5
    expect(conduct).toMatchObject({ punctuality: 3, treatment: 4, ratingCount: 3, noShows: 1 });
    expect(conduct.completed).toBeGreaterThanOrEqual(4);
    expect(conduct.attendanceRate).toBe(
      Math.round((conduct.completed / (conduct.completed + 1)) * 100),
    );
  });

  it('a equipe vê a nota: recepção pra cima sempre; barbeiro só de quem atende', async () => {
    const byManager = await ratings.conductForStaff(users.dono, shops.a, customerA);
    expect(byManager.ratingCount).toBe(3);
    expect((await ratings.conductForStaff(users.recep, shops.a, customerA)).ratingCount).toBe(3);
    expect((await ratings.conductForStaff(users.pro, shops.a, customerA)).ratingCount).toBe(3);
    await expect(ratings.conductForStaff(users.outro, shops.a, customerA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Ficha de outra rede não se abre por esta unidade
    await expect(ratings.conductForStaff(users.dono, shops.a, customerB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('selos do cliente e o que ele deu em cada atendimento (a unidade vê tudo, o barbeiro só os dele)', async () => {
    expect((await ratings.myConduct(accountId)).badges).toEqual([]);
    const done = await appointment('a', 'pro', customerA, 6);
    await prisma.appointmentTip.create({
      data: {
        appointmentId: done.id,
        barbershopId: shops.a,
        barberId: barbers.pro,
        destination: 'professional',
        method: 'PIX',
        amount: 12.5,
        currency: 'BRL',
        createdByUserId: users.dono,
      },
    });
    await prisma.professionalReview.create({
      data: {
        appointmentId: done.id,
        barberId: barbers.pro,
        barbershopId: shops.a,
        customerId: customerA,
        rating: 5,
      },
    });
    const byOwner = await ratings.visitFeedback(users.dono, shops.a, customerA);
    expect(byOwner.find((f) => f.appointmentId === done.id)).toEqual({
      appointmentId: done.id,
      rating: 5,
      tip: 12.5,
    });
    expect(
      (await ratings.visitFeedback(users.outro, shops.a, customerA)).some(
        (f) => f.appointmentId === done.id,
      ),
    ).toBe(false);
    await prisma.professionalReview.deleteMany({ where: { appointmentId: done.id } });
  });

  it('pendentes e resumo do dia: um e-mail por profissional, uma vez por atendimento', async () => {
    const todo = await appointment('a', 'pro', customerA, 4);
    const pending = await ratings.pendingForMe(users.pro);
    expect(pending.map((p) => p.appointmentId)).toContain(todo.id);
    expect(pending.every((p) => p.barbershopName === 'Unidade a')).toBe(true);

    await ratings.sendDailyDigest();
    const mine = emails.filter((e) => e.userId === users.pro);
    expect(mine).toHaveLength(1);
    expect(mine[0].context.Appointments.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].context.RateURL).toContain('/rate-clients');

    emails.length = 0;
    await ratings.sendDailyDigest();
    expect(emails.filter((e) => e.userId === users.pro)).toHaveLength(0);

    await ratings.rate(users.pro, shops.a, todo.id, 'professional', 5, 5);
    expect((await ratings.pendingForMe(users.pro)).map((p) => p.appointmentId)).not.toContain(
      todo.id,
    );
  });

  it('guarda: sai depois de 2 anos sem atendimento novo daquela ficha', async () => {
    const lonely = await prisma.customer.create({
      data: { networkId: networks[0], name: 'Sumido', phone: `5${RUN}` },
    });
    const gone = await prisma.appointment.create({
      data: {
        barbershopId: shops.a,
        barberId: barbers.pro,
        customerId: lonely.id,
        startAt: new Date(Date.now() - 800 * DAY),
        endAt: new Date(Date.now() - 800 * DAY + HOUR),
        status: 'COMPLETED',
      },
    });
    const old = await prisma.customerRating.create({
      data: {
        appointmentId: gone.id,
        side: 'professional',
        barbershopId: shops.a,
        customerId: lonely.id,
        raterUserId: users.pro,
        punctuality: 5,
        treatment: 5,
        createdAt: new Date(Date.now() - 800 * DAY),
      },
    });
    // Ficha ativa: a nota antiga fica
    const active = await prisma.customerRating.create({
      data: {
        appointmentId: (await appointment('a', 'outro', customerA, 800 * 24)).id,
        side: 'professional',
        barbershopId: shops.a,
        customerId: customerA,
        raterUserId: users.outro,
        punctuality: 1,
        treatment: 1,
        createdAt: new Date(Date.now() - 800 * DAY),
      },
    });

    await new RetentionService(prisma).run();
    expect(await prisma.customerRating.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.customerRating.findUnique({ where: { id: active.id } })).not.toBeNull();
  });
});
