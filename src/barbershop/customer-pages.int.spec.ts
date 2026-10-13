/**
 * Listas grandes (item 129): a busca de clientes acha quem está depois dos
 * primeiros 50, a página vem com limite e deslocamento, e a agenda traz o
 * nome do cliente em cada horário.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

describe('Listas de clientes e agenda (integração)', () => {
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
  let basicId: number;
  let networkId: number;
  let shopId: number;

  const user = async (label: string, roleId: number) =>
    (
      await prisma.user.create({
        data: {
          email: `pages-${label}-${RUN}@test.local`,
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

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = await user('dona', roleId);
    basicId = await user('basico', roleId);
    networkId = (
      await prisma.network.create({
        data: {
          ownerUserId: ownerId,
          name: `Rede Listas ${RUN}`,
        },
      })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Barbearia Listas',
          slug: `pages-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `pages-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    await prisma.barber.create({
      data: { barbershopId: shopId, name: 'Ana', phone: '11911111111' },
    });
    await prisma.barber.create({
      data: {
        barbershopId: shopId,
        name: 'Básico',
        phone: '11933333333',
        userId: basicId,
        staffType: 'basic',
      },
    });
    await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(80) },
    });
    await prisma.customer.create({
      data: { networkId, name: 'Aaron Primeiro', phone: `5${RUN.slice(-10)}` },
    });
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('acha o cliente depois dos 50 primeiros, pagina, e a agenda traz o nome', async () => {
    await prisma.customer.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        networkId,
        name: `Cliente ${String(i).padStart(2, '0')}`,
        phone: `7${RUN.slice(-8)}${String(i).padStart(2, '0')}`,
      })),
    });
    const last = await prisma.customer.create({
      data: { networkId, name: 'Zé Último', phone: `8${RUN.slice(-10)}` },
    });
    // Sem busca vêm só os 50 primeiros (o Zé não está)
    const first = await shops.getCustomers(ownerId, shopId, {});
    expect(first).toHaveLength(50);
    expect(first.some((c) => c.id === last.id)).toBe(false);
    // Na busca ele aparece
    const found = await shops.getCustomers(ownerId, shopId, { search: 'zé últ' });
    expect(found.map((c) => c.id)).toEqual([last.id]);
    // E nas páginas seguintes
    const second = await shops.getCustomers(ownerId, shopId, { limit: 50, offset: 50 });
    expect(second.map((c) => c.id)).toContain(last.id);

    // Horário do barbeiro básico (ele só vê a própria agenda)
    const barber = await prisma.barber.findFirstOrThrow({
      where: { barbershopId: shopId, userId: basicId },
    });
    const start = new Date(Date.now() + 2 * 86_400_000);
    await prisma.appointment.create({
      data: {
        barbershopId: shopId,
        barberId: barber.id,
        customerId: last.id,
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        status: 'CONFIRMED',
      },
    });
    const agenda = await shops.getAppointments(ownerId, shopId, {
      startFrom: new Date(start.getTime() - 3_600_000),
      startTo: new Date(start.getTime() + 3_600_000),
    });
    expect(agenda[0]).toMatchObject({ customerName: 'Zé Último', customerPhone: last.phone });
    // Barbeiro básico não vê o telefone, mas vê o nome
    const basicView = await shops.getAppointments(basicId, shopId, {
      startFrom: new Date(start.getTime() - 3_600_000),
      startTo: new Date(start.getTime() + 3_600_000),
    });
    expect(basicView[0]).toMatchObject({ customerName: 'Zé Último', customerPhone: null });
  });

  it('código de indicação aleatório, o mesmo a cada pedido', async () => {
    const c = await prisma.customer.create({
      data: { networkId, name: 'Indica', phone: `6${RUN.slice(-10)}` },
    });
    const first = await shops.getCustomerReferralInfo(ownerId, shopId, c.id);
    expect(first.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(first.referralCode).not.toBe(c.id.toString(36).toUpperCase());
    expect((await shops.getCustomerReferralInfo(ownerId, shopId, c.id)).referralCode).toBe(
      first.referralCode,
    );
  });
});
