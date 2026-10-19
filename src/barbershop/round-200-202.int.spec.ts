/**
 * Itens 200 a 202, contra o Postgres de verdade: sala com horário não se
 * apaga, sessão coberta é de um atendimento e regra de comissão padrão única.
 */
import { PrismaService } from '../prisma/prisma.service';
import {
  BarbershopService,
  COVERED_SESSION_QUANTITY_MESSAGE,
  RESOURCE_IN_USE_MESSAGE,
} from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TZ = 'America/Sao_Paulo';

describe('Sala, sessão coberta e comissão (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stub,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  let serviceId: number;
  let barberId: number;
  let customerId: number;

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r200-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r200${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede ${RUN}`,
          loyaltyEnabled: true,
          loyaltyPointsPerCurrencyUnit: 0,
          referralBonusPoints: 50,
        },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Rodada 200',
          slug: `r200-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r200-shop-${RUN}@test.local`,
          timezone: TZ,
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    serviceId = (
      await prisma.barbershopService.create({
        data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: 50 },
      })
    ).id;
    barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Bia', phone: `+55116${RUN}`.slice(0, 20) },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { networkId, name: 'Cliente', phone: `+55115${RUN}`.slice(0, 20) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  // ---- 200: sala ----

  const appointmentIn = (resourceId: number, startAt: Date, status = 'CONFIRMED') =>
    prisma.appointment.create({
      data: {
        barbershopId: shopId,
        customerId,
        barberId,
        resourceId,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        status,
      },
    });

  it('sala com horário marcado não se apaga; só no passado, é desativada', async () => {
    const room = await shops.createResource(ownerId, shopId, { name: ' Sala 1 ', type: 'ROOM' });
    expect(room.name).toBe('Sala 1');
    const future = await appointmentIn(room.id, new Date(Date.now() + 86_400_000));
    await expect(shops.deleteResource(ownerId, shopId, room.id)).rejects.toThrow(
      RESOURCE_IN_USE_MESSAGE,
    );
    await prisma.appointment.update({
      where: { id: future.id },
      data: {
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() - 86_000_000),
        status: 'COMPLETED',
      },
    });
    await shops.deleteResource(ownerId, shopId, room.id);
    const kept = await prisma.resource.findUniqueOrThrow({ where: { id: room.id } });
    expect(kept.isActive).toBe(false);
    const past = await prisma.appointment.findUniqueOrThrow({ where: { id: future.id } });
    expect(past.resourceId).toBe(room.id);

    const unused = await shops.createResource(ownerId, shopId, { name: 'Cadeira', type: 'CHAIR' });
    await shops.deleteResource(ownerId, shopId, unused.id);
    expect(await prisma.resource.findUnique({ where: { id: unused.id } })).toBeNull();
  });

  it('nome vazio e tipo desconhecido são recusados', async () => {
    await expect(shops.createResource(ownerId, shopId, { name: '  ' })).rejects.toThrow(
      'Informe o nome da sala',
    );
    await expect(
      shops.createResource(ownerId, shopId, { name: 'Sala', type: 'sala' }),
    ).rejects.toThrow('Tipo de sala inválido');
  });

  // ---- 201: sessão coberta ----

  it('sessão do pacote cobre uma linha do serviço com quantidade 1', async () => {
    const offer = await prisma.servicePackage.create({
      data: { barbershopId: shopId, serviceId, name: '5 cortes', totalSessions: 5, price: 200 },
    });
    const pkg = await prisma.clientPackage.create({
      data: { barbershopId: shopId, customerId, servicePackageId: offer.id, totalSessions: 5 },
    });
    const covered = (quantity: number, lines = 1) =>
      shops.createSale(ownerId, shopId, {
        customerId,
        barberId,
        clientPackageId: pkg.id,
        saleType: 'SERVICE',
        items: Array.from({ length: lines }, () => ({
          itemType: 'SERVICE',
          serviceId,
          quantity,
          unitPrice: 0,
          totalPrice: 0,
        })),
        subtotal: 0,
        total: 0,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
      });
    await expect(covered(3)).rejects.toThrow(COVERED_SESSION_QUANTITY_MESSAGE);
    await expect(covered(1, 2)).rejects.toThrow(COVERED_SESSION_QUANTITY_MESSAGE);
    await covered(1);
    const after = await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(after.usedSessions).toBe(1);
  });

  // ---- 202: regra de comissão ----

  it('dois salvamentos juntos da regra padrão deixam uma regra só', async () => {
    await Promise.all([
      shops.setCommissionRule(ownerId, shopId, { itemType: 'SERVICE', percentage: 30 }),
      shops.setCommissionRule(ownerId, shopId, { itemType: 'SERVICE', percentage: 40 }),
    ]);
    await shops.setCommissionRule(ownerId, shopId, { itemType: 'SERVICE', percentage: 45 });
    const rules = await prisma.commissionRule.findMany({
      where: { barbershopId: shopId, barberId: null, itemType: 'SERVICE' },
    });
    expect(rules).toHaveLength(1);
    expect(Number(rules[0].percentage)).toBe(45);
  });

  it('o banco recusa a segunda regra padrão igual', async () => {
    await expect(
      prisma.commissionRule.create({
        data: { barbershopId: shopId, itemType: 'SERVICE', percentage: 10 },
      }),
    ).rejects.toThrow();
  });

  it('tipo da regra fora de ALL, SERVICE e PRODUCT é recusado', async () => {
    await expect(
      shops.setCommissionRule(ownerId, shopId, { itemType: 'service', percentage: 10 }),
    ).rejects.toThrow('Tipo da regra de comissão inválido');
  });
});
