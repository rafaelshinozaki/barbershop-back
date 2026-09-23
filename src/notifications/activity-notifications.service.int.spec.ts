/**
 * Avisos de atividade das unidades contra um Postgres de verdade: quem
 * recebe (dono, gerente, barbeiro envolvido — nunca quem fez), idioma de
 * cada um, preferência por categoria (sininho x e-mail) e estoque baixo só
 * quando cruza o mínimo. Mesmo esquema do barbershop.service.int.spec.ts:
 * dados com sufixo único, apagados no final.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityNotificationsService } from './activity-notifications.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('ActivityNotificationsService (integração com o banco)', () => {
  const prisma = new PrismaService();
  const emails: Array<{ to: string; subject: string; jobId?: string }> = [];
  const pushed: number[] = [];
  let service: ActivityNotificationsService;

  const ids = {} as {
    owner: number;
    manager: number;
    barberUser: number;
    otherBarberUser: number;
    networkId: number;
    shopId: number;
    barberId: number;
    otherBarberId: number;
    customerId: number;
    serviceId: number;
    productId: number;
  };

  async function createUser(label: string, roleId: number, language: string) {
    const user = await prisma.user.create({
      data: {
        email: `act-${label}-${RUN}@test.local`,
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
    await prisma.userSystemConfig.create({
      data: {
        userId: user.id,
        theme: 'light',
        accentColor: 'bronze',
        grayColor: 'gray',
        radius: 'medium',
        scaling: '100%',
        language,
      },
    });
    return user.id;
  }

  const notificationsOf = (userId: number) =>
    prisma.userNotification.findMany({ where: { userId }, orderBy: { id: 'asc' } });

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    service = new ActivityNotificationsService(
      prisma,
      { notifyUsers: (userIds: number[]) => pushed.push(...userIds) } as never,
      {
        email: async (job: { to: string; subject: string }, jobId?: string) => {
          emails.push({ to: job.to, subject: job.subject, jobId });
        },
      } as never,
      { get: () => 'https://app.test' } as never,
    );

    ids.owner = await createUser('owner', role.id, 'pt');
    ids.manager = await createUser('manager', role.id, 'en');
    ids.barberUser = await createUser('barber', role.id, 'es');
    ids.otherBarberUser = await createUser('other', role.id, 'pt');

    ids.networkId = (
      await prisma.network.create({ data: { ownerUserId: ids.owner, name: `Rede ${RUN}` } })
    ).id;
    ids.shopId = (
      await prisma.barbershop.create({
        data: {
          name: `Unidade ${RUN}`,
          slug: `act-${RUN}`,
          address: 'Rua Teste, 1',
          city: 'São Paulo',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `act-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          currency: 'BRL',
          networkId: ids.networkId,
          ownerUserId: ids.owner,
        },
      })
    ).id;
    await prisma.barber.create({
      data: {
        barbershopId: ids.shopId,
        name: 'Gerente',
        phone: '11900000000',
        staffType: 'manager',
        userId: ids.manager,
      },
    });
    ids.barberId = (
      await prisma.barber.create({
        data: {
          barbershopId: ids.shopId,
          name: 'Barbeiro',
          phone: '11911111111',
          userId: ids.barberUser,
        },
      })
    ).id;
    ids.otherBarberId = (
      await prisma.barber.create({
        data: {
          barbershopId: ids.shopId,
          name: 'Outro',
          phone: '11922222222',
          userId: ids.otherBarberUser,
        },
      })
    ).id;
    ids.customerId = (
      await prisma.customer.create({
        data: { networkId: ids.networkId, name: 'Cliente Ana', phone: `11${RUN}` },
      })
    ).id;
    ids.serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: ids.shopId,
          name: 'Corte',
          durationMinutes: 30,
          price: new Decimal(50),
        },
      })
    ).id;
    ids.productId = (
      await prisma.barbershopProduct.create({
        data: { barbershopId: ids.shopId, name: 'Pomada', salePrice: new Decimal(30) },
      })
    ).id;
  });

  afterEach(async () => {
    const userIds = [ids.owner, ids.manager, ids.barberUser, ids.otherBarberUser];
    await prisma.userNotification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    emails.length = 0;
    pushed.length = 0;
  });

  afterAll(async () => {
    const shopId = ids.shopId;
    const items = await prisma.inventoryItem.findMany({ where: { barbershopId: shopId } });
    await prisma.inventoryMovement.deleteMany({
      where: { inventoryItemId: { in: items.map((i) => i.id) } },
    });
    await prisma.inventoryItem.deleteMany({ where: { barbershopId: shopId } });
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    const appts = await prisma.appointment.findMany({ where: { barbershopId: shopId } });
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: appts.map((a) => a.id) } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: shopId } });
    await prisma.customer.deleteMany({ where: { networkId: ids.networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershopProduct.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: ids.networkId } });
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `-${RUN}@test.local` } },
      select: { id: true },
    });
    await prisma.userSystemConfig.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  async function createAppointment() {
    const startAt = new Date('2030-03-04T13:00:00Z'); // 10:00 em São Paulo
    return prisma.appointment.create({
      data: {
        barbershopId: ids.shopId,
        customerId: ids.customerId,
        barberId: ids.barberId,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60000),
        services: {
          create: [{ serviceId: ids.serviceId, unitPrice: new Decimal(50), quantity: 1 }],
        },
      },
    });
  }

  it('agendamento feito pelo dono avisa gerente e barbeiro envolvido, no idioma de cada um', async () => {
    const appt = await createAppointment();
    await service.appointmentCreated(appt.id, ids.owner);

    expect(await notificationsOf(ids.owner)).toHaveLength(0); // quem fez não recebe
    expect(await notificationsOf(ids.otherBarberUser)).toHaveLength(0); // não é o barbeiro dele

    const [manager] = await notificationsOf(ids.manager);
    expect(manager.title).toBe('New appointment');
    expect(manager.message).toContain('Cliente Ana');
    expect(manager.message).toContain('Corte');
    expect(manager.actionUrl).toBe(`/barbershops/${ids.shopId}/appointments`);

    const [barber] = await notificationsOf(ids.barberUser);
    expect(barber.title).toBe('Nueva cita');
    // Data no fuso da unidade, não em UTC
    expect(barber.message).toContain('10:00');

    expect(new Set(pushed)).toEqual(new Set([ids.manager, ids.barberUser]));
    expect(emails).toHaveLength(0); // agenda: e-mail desligado por padrão
  });

  it('agendamento online (sem autor) avisa o dono também', async () => {
    const appt = await createAppointment();
    await service.appointmentCreated(appt.id, null);
    const [owner] = await notificationsOf(ids.owner);
    expect(owner.title).toBe('Novo agendamento online');
  });

  it('atendimento concluído pelo barbeiro avisa o dono; status sem aviso é ignorado', async () => {
    const appt = await createAppointment();
    await service.appointmentStatusChanged(appt.id, 'COMPLETED', ids.barberUser);
    const [owner] = await notificationsOf(ids.owner);
    expect(owner.title).toBe('Atendimento concluído');
    expect(owner.type).toBe('success');
    expect(await notificationsOf(ids.barberUser)).toHaveLength(0);

    await service.appointmentStatusChanged(appt.id, 'IN_PROGRESS', ids.barberUser);
    expect(await notificationsOf(ids.owner)).toHaveLength(1);
  });

  it('respeita a preferência: venda só por e-mail pra quem desligou o sininho', async () => {
    await prisma.notificationPreference.create({
      data: { userId: ids.owner, salesInApp: false, salesEmail: true },
    });
    await prisma.notificationPreference.create({
      data: { userId: ids.manager, salesInApp: false, salesEmail: false },
    });
    const sale = await prisma.sale.create({
      data: {
        barbershopId: ids.shopId,
        customerId: ids.customerId,
        barberId: ids.barberId,
        saleType: 'MIXED',
        subtotal: new Decimal(80),
        total: new Decimal(80),
      },
    });
    await service.saleCreated(sale.id, ids.barberUser);

    expect(await notificationsOf(ids.owner)).toHaveLength(0);
    expect(await notificationsOf(ids.manager)).toHaveLength(0);
    expect(emails).toEqual([
      {
        to: `act-owner-${RUN}@test.local`,
        subject: `Nova venda · Unidade ${RUN}`,
        jobId: `activity:sale:${sale.id}:${ids.owner}`,
      },
    ]);
  });

  it('estoque baixo só avisa quando a venda cruza o mínimo', async () => {
    const item = await prisma.inventoryItem.create({
      data: {
        barbershopId: ids.shopId,
        productId: ids.productId,
        quantity: new Decimal(2),
        minQuantity: new Decimal(3),
      },
    });
    const sell = async (before: number, after: number) => {
      const sale = await prisma.sale.create({
        data: {
          barbershopId: ids.shopId,
          saleType: 'PRODUCT',
          subtotal: new Decimal(30),
          total: new Decimal(30),
        },
      });
      await prisma.inventoryMovement.create({
        data: {
          inventoryItemId: item.id,
          movementType: 'SALE',
          quantityChange: after - before,
          quantityBefore: before,
          quantityAfter: after,
          referenceType: 'SALE',
          referenceId: String(sale.id),
        },
      });
      await service.saleCreated(sale.id, ids.barberUser);
    };

    await sell(4, 3); // cruzou (4 > 3 >= 3)
    await sell(3, 2); // já estava baixo — não repete
    const lowStock = (await notificationsOf(ids.owner)).filter((n) => n.title === 'Estoque baixo');
    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].message).toContain('Pomada');
    // Estoque: e-mail ligado por padrão
    expect(emails.filter((e) => e.jobId?.startsWith('activity:low-stock'))).toHaveLength(2); // dono + gerente
  });
});
