/**
 * Profissional em várias unidades (é autônomo: trabalha em mais de uma
 * barbearia, até de donos diferentes) e vínculo temporário (freelancer),
 * contra o Postgres de verdade.
 */
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { EmployeeInviteService } from './employee-invite.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86400_000;

function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);

describe('Profissional em várias unidades e vínculo temporário (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const service = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  const sent: string[] = [];
  const invites = new EmployeeInviteService(
    prisma,
    { sendCustomerEmail: async (...args: unknown[]) => void sent.push(args[5] as string) } as never,
    { get: () => 'https://app.test' } as never,
    service,
    { notify: () => undefined } as never,
    { memberJoined: async () => undefined } as never,
  );
  const day = nextMonday();

  let roleId: number;
  const shops: {
    ownerId: number;
    networkId: number;
    shopId: number;
    serviceId: number;
    customerId: number;
  }[] = [];
  let proUserId: number;
  let proInA: number;
  let proInB: number;

  const createUser = async (label: string) =>
    prisma.user.create({
      data: {
        email: `mu-${label}-${RUN}@test.local`,
        password: 'x',
        fullName: `Teste ${label}`,
        idDocNumber: `${RUN}${label}`.slice(-20),
        phone: `+5511${RUN}`.slice(0, 20),
        gender: 'male',
        birthdate: new Date('1990-01-01'),
        readTerms: true,
        roleId,
      },
    });

  const book = (shop: number, barberId: number, startAt: Date) =>
    service.createAppointment(shops[shop].ownerId, shops[shop].shopId, {
      customerId: shops[shop].customerId,
      barberId,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60000),
      services: [{ serviceId: shops[shop].serviceId, unitPrice: 50 }],
    });

  beforeAll(async () => {
    roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    // Duas barbearias de donos diferentes
    for (const label of ['a', 'b']) {
      const owner = await createUser(`owner${label}`);
      const network = await prisma.network.create({
        data: { ownerUserId: owner.id, name: `Rede MU ${label} ${RUN}` },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `MU ${label}`,
          slug: `mu-${label}-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `mu-${label}-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId: network.id,
          ownerUserId: owner.id,
        },
      });
      const svc = await prisma.barbershopService.create({
        data: { barbershopId: shop.id, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
      });
      const customer = await prisma.customer.create({
        data: { networkId: network.id, name: `Cliente ${label}`, phone: `11${RUN}${label}` },
      });
      shops.push({
        ownerId: owner.id,
        networkId: network.id,
        shopId: shop.id,
        serviceId: svc.id,
        customerId: customer.id,
      });
    }
    // O profissional autônomo: conta própria, já trabalha na A
    proUserId = (await createUser('pro')).id;
    proInA = (
      await prisma.barber.create({
        data: {
          barbershopId: shops[0].shopId,
          name: 'Autônomo',
          phone: '11900000001',
          userId: proUserId,
        },
      })
    ).id;
  });

  afterAll(async () => {
    const shopIds = shops.map((s) => s.shopId);
    const appts = await prisma.appointment.findMany({
      where: { barbershopId: { in: shopIds } },
      select: { id: true },
    });
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: appts.map((a) => a.id) } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.employeeInvite.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barberSchedule.deleteMany({
      where: { barber: { barbershopId: { in: shopIds } } },
    });
    await prisma.barber.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.customer.deleteMany({
      where: { networkId: { in: shops.map((s) => s.networkId) } },
    });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({ where: { id: { in: shops.map((s) => s.networkId) } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('convite pra quem já tem conta: aceita com a conta dele (e só ele), sem criar outra', async () => {
    const pro = await prisma.user.findUniqueOrThrow({ where: { id: proUserId } });
    const { barber } = await invites.createInvite(shops[1].ownerId, {
      barbershopId: shops[1].shopId,
      email: pro.email,
      name: 'Autônomo',
      phone: '11900000002',
      role: 'BarbershopEmployee',
      staffType: 'barber',
    });
    proInB = barber.id;
    const invite = await prisma.employeeInvite.findFirstOrThrow({ where: { barberId: barber.id } });
    expect(sent).toContain(pro.email);
    expect(await invites.validateInvite(invite.inviteToken)).toMatchObject({
      existingAccount: true,
      staffType: 'barber',
    });

    // Outra pessoa logada não aceita o convite dele
    await expect(
      invites.acceptInviteAsUser(invite.inviteToken, shops[0].ownerId),
    ).rejects.toBeInstanceOf(BadRequestException);

    await invites.acceptInviteAsUser(invite.inviteToken, proUserId);
    expect(await prisma.user.count({ where: { email: pro.email } })).toBe(1);
    const mine = (await service.getUserBarbershops(proUserId)).map((b) => b.id);
    expect(mine).toEqual(expect.arrayContaining([shops[0].shopId, shops[1].shopId]));
    expect(await service.getMyAccessLevel(proUserId, shops[1].shopId)).toBe('barber');

    // Convidar de novo quem já está na equipe não passa
    await expect(
      invites.createInvite(shops[1].ownerId, {
        barbershopId: shops[1].shopId,
        email: pro.email,
        name: 'Autônomo',
        phone: '11900000003',
        role: 'BarbershopEmployee',
      }),
    ).rejects.toThrow(/já está na equipe/);
  });

  it('e-mail do convite fora do ar: o convite vale mesmo assim (e avisa que o e-mail não saiu)', async () => {
    const failing = new EmployeeInviteService(
      prisma,
      {
        sendCustomerEmail: async () => {
          throw new Error('Mailgun fora do ar');
        },
      } as never,
      { get: () => 'https://app.test' } as never,
      service,
      { notify: () => undefined } as never,
      { memberJoined: async () => undefined } as never,
    );
    const result = await failing.createInvite(shops[0].ownerId, {
      barbershopId: shops[0].shopId,
      email: `mu-semmail-${RUN}@test.local`,
      name: 'Sem e-mail',
      phone: '11900000009',
      role: 'BarbershopEmployee',
    });
    expect(result.emailSent).toBe(false);
    expect(
      await prisma.employeeInvite.count({ where: { id: result.invite.id, status: 'PENDING' } }),
    ).toBe(1);
  });

  it('escala sobreposta em outra unidade não passa; turno encostado passa', async () => {
    const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7;
    await service.createBarberSchedule(shops[0].ownerId, {
      barberId: proInA,
      dayOfWeek: dow,
      startTime: '09:00',
      endTime: '12:00',
    });
    await expect(
      service.createBarberSchedule(shops[1].ownerId, {
        barberId: proInB,
        dayOfWeek: dow,
        startTime: '11:00',
        endTime: '14:00',
      }),
    ).rejects.toThrow(/outra unidade/);
    await expect(
      service.createBarberSchedule(shops[1].ownerId, {
        barberId: proInB,
        dayOfWeek: dow,
        startTime: '12:00',
        endTime: '18:00',
      }),
    ).resolves.toMatchObject({ barberId: proInB });
    const [inA, inB] = await Promise.all([
      prisma.barber.findUniqueOrThrow({ where: { id: proInA } }),
      prisma.barber.findUniqueOrThrow({ where: { id: proInB } }),
    ]);
    expect(inA.professionalId).toBeTruthy();
    expect(inB.professionalId).toBe(inA.professionalId);
  });

  it('o horário dele é um só: a outra unidade vê "ocupado", sem detalhes', async () => {
    await book(0, proInA, at(day, '16:00'));
    await expect(book(1, proInB, at(day, '16:00'))).rejects.toThrow(/ocupado em outra unidade/);
    await expect(book(1, proInB, at(day, '16:15'))).rejects.toThrow(/outra unidade/);
    await expect(book(1, proInB, at(day, '16:30'))).resolves.toBeTruthy();

    // A página pública da B não oferece o horário que ele tem na A
    await prisma.barberSchedule.create({
      data: {
        barberId: proInB,
        dayOfWeek: new Date(`${day}T12:00:00Z`).getUTCDay(),
        startTime: '09:00',
        endTime: '19:00',
      },
    });
    const slots = await service.getPublicAvailableSlots(
      shops[1].shopId,
      proInB,
      [shops[1].serviceId],
      day,
    );
    expect(slots).not.toContain(at(day, '16:00').toISOString());
    expect(slots).not.toContain(at(day, '16:30').toISOString());
    expect(slots).toContain(at(day, '17:00').toISOString());

    // A unidade A não vê nada da B
    const seenByA = await service.getAppointments(shops[0].ownerId, shops[0].shopId, {
      limit: 500,
    });
    expect(seenByA.every((a) => a.barbershopId === shops[0].shopId)).toBe(true);
  });

  it('duas unidades vendendo o mesmo horário dele ao mesmo tempo: só uma leva', async () => {
    const results = await Promise.allSettled([
      book(0, proInA, at(day, '18:00')),
      book(1, proInB, at(day, '18:00')),
      book(0, proInA, at(day, '18:00')),
      book(1, proInB, at(day, '18:00')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('vínculo temporário: só entra e atende dentro do período', async () => {
    const shop = shops[1];
    // Freelancer que já terminou
    await service.updateBarber(shop.ownerId, shop.shopId, proInB, {
      accessStartsAt: new Date(Date.now() - 10 * DAY).toISOString(),
      accessEndsAt: new Date(Date.now() - DAY).toISOString(),
    });
    expect(await service.getMyAccessLevel(proUserId, shop.shopId)).toBeNull();
    expect((await service.getUserBarbershops(proUserId)).map((b) => b.id)).not.toContain(
      shop.shopId,
    );
    const pub = await service.getPublicBarbershopByslug(`mu-b-${RUN}`);
    expect(pub.barbers.map((b: { id: number }) => b.id)).not.toContain(proInB);
    // Na A continua normal
    expect(await service.getMyAccessLevel(proUserId, shops[0].shopId)).toBe('barber');

    // Freelancer que atende só até amanhã: agendar depois disso não passa
    await service.updateBarber(shop.ownerId, shop.shopId, proInB, {
      accessStartsAt: null,
      accessEndsAt: new Date(Date.now() + DAY).toISOString(),
    });
    expect(await service.getMyAccessLevel(proUserId, shop.shopId)).toBe('barber');
    await expect(
      book(1, proInB, new Date(new Date(`${day}T10:00:00-03:00`).getTime() + 7 * DAY)),
    ).rejects.toThrow(/fora do período/);
    expect(
      await service.getPublicAvailableSlots(
        shop.shopId,
        proInB,
        [shop.serviceId],
        new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10),
      ),
    ).toEqual([]);

    // Fim antes do início não passa
    await expect(
      service.updateBarber(shop.ownerId, shop.shopId, proInB, {
        accessStartsAt: new Date(Date.now() + 5 * DAY).toISOString(),
        accessEndsAt: new Date(Date.now() + DAY).toISOString(),
      }),
    ).rejects.toThrow(/antes do início/);

    // Sem limite de novo
    await service.updateBarber(shop.ownerId, shop.shopId, proInB, {
      accessStartsAt: null,
      accessEndsAt: null,
    });
    expect(await service.getMyAccessLevel(proUserId, shop.shopId)).toBe('barber');
  });

  it('dono com duas unidades entra na equipe das duas (a agenda dele também é uma só)', async () => {
    const owner = await createUser('dono2');
    const premium =
      (await prisma.plan.findFirst({ where: { name: 'Premium' } })) ??
      (await prisma.plan.create({
        data: { name: 'Premium', price: new Decimal(100), billingCycle: 'MONTHLY' },
      }));
    await prisma.subscription.create({
      data: {
        userId: owner.id,
        planId: premium.id,
        status: 'ACTIVE',
        startSubDate: new Date(),
      },
    });
    const create = (label: string) =>
      service.createBarbershop(owner.id, {
        name: `MU ${label}`,
        slug: `mu-${label}-${RUN}`,
        address: 'Rua 2',
        city: 'SP',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `mu-${label}-${RUN}@test.local`,
      });
    const first = await create('d1');
    const second = await create('d2');
    const network = await prisma.network.findFirstOrThrow({ where: { ownerUserId: owner.id } });
    for (const shop of [first, second]) {
      shops.push({
        ownerId: owner.id,
        networkId: network.id,
        shopId: shop.id,
        serviceId: 0,
        customerId: 0,
      });
    }
    const links = await prisma.barber.findMany({ where: { userId: owner.id } });
    expect(links.map((b) => b.barbershopId).sort()).toEqual([first.id, second.id].sort());
    await prisma.subscription.deleteMany({ where: { userId: owner.id } });
  });
});
