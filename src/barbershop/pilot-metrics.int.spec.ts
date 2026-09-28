/**
 * Métrica do piloto contra o Postgres: cada busca vira um registro, o job
 * avalia se alguma das primeiras unidades tinha horário em até 48 h, e os
 * números por cidade juntam as buscas e os agendamentos vindos da vitrine.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
import { PilotMetricsService } from './pilot-metrics.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const CITY = `Cidade Piloto ${RUN}`;
const everyDay = JSON.stringify(
  Object.fromEntries(
    ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [
      d,
      { start: '00:00', end: '23:59' },
    ]),
  ),
);

describe('Métrica do piloto (integração)', () => {
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
  const pilot = new PilotMetricsService(prisma, barbershops);
  let ownerId: number;
  let networkId: number;
  let openShop: number;
  let emptyShop: number;

  const shop = async (label: string, withBarber: boolean) => {
    const b = await prisma.barbershop.create({
      data: {
        name: `Piloto ${label}`,
        slug: `piloto-${label}-${RUN}`,
        address: 'Rua A, 1',
        city: CITY,
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `piloto-${label}-${RUN}@test.local`,
        timezone: 'UTC',
        businessHours: everyDay,
        networkId,
        ownerUserId: ownerId,
        services: {
          create: [
            { name: 'Corte', durationMinutes: 30, price: new Decimal(50), category: 'HAIR' },
          ],
        },
      },
    });
    if (withBarber) {
      await prisma.barber.create({
        data: { barbershopId: b.id, name: 'Ana', phone: '11911111111' },
      });
    }
    return b.id;
  };

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `piloto-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dono Piloto',
          idDocNumber: RUN.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede Piloto ${RUN}` } })
    ).id;
    openShop = await shop('aberta', true);
    // Sem profissional: nunca tem horário
    emptyShop = await shop('vazia', false);
  });

  afterAll(async () => {
    await prisma.searchEvent.deleteMany({ where: { city: CITY } });
    await prisma.appointmentService.deleteMany({
      where: { appointment: { barbershopId: { in: [openShop, emptyShop] } } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: { in: [openShop, emptyShop] } } });
    await prisma.customer.deleteMany({ where: { networkId } });
    await prisma.barber.deleteMany({ where: { barbershopId: { in: [openShop, emptyShop] } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: [openShop, emptyShop] } } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('registra as buscas, avalia a liquidez e soma por cidade e categoria', async () => {
    // Achou: a unidade aberta está entre as primeiras
    await pilot.recordSearch({ city: CITY, category: 'HAIR' }, [
      { id: emptyShop, city: CITY },
      { id: openShop, city: CITY },
    ]);
    // Não achou: só a unidade sem profissional
    await pilot.recordSearch({ city: CITY, category: 'HAIR' }, [{ id: emptyShop, city: CITY }]);
    // Sem resultado: já nasce avaliada como "não achou"
    await pilot.recordSearch({ city: CITY }, []);
    // Por localização (sem cidade): vale a cidade da primeira unidade
    await pilot.recordSearch({ lat: -23.5, lng: -46.6 }, [{ id: openShop, city: CITY }]);

    const before = await pilot.metrics(7, CITY);
    expect(before).toMatchObject({ searches: 4, evaluated: 1, foundWithin48h: 0 });

    while ((await pilot.evaluatePending()) > 0);
    const after = await pilot.metrics(7, CITY.toUpperCase());
    expect(after).toMatchObject({ searches: 4, evaluated: 4, foundWithin48h: 2, foundRate: 0.5 });
    expect(after.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'HAIR', searches: 2, foundWithin48h: 1 }),
        expect.objectContaining({ category: 'ANY', searches: 2, foundWithin48h: 1 }),
      ]),
    );
    const events = await prisma.searchEvent.findMany({
      where: { city: CITY },
      orderBy: { id: 'asc' },
    });
    expect(events.map((e) => e.hasPoint)).toEqual([false, false, false, true]);
  });

  it('agendamentos online da cidade por canal, com os clientes novos da vitrine', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const book = async (time: string, phone: string, channel?: string) =>
      barbershops.createPublicAppointment({
        barbershopId: openShop,
        serviceIds: [
          (await prisma.barbershopService.findFirstOrThrow({ where: { barbershopId: openShop } }))
            .id,
        ],
        startAt: new Date(`${tomorrow}T${time}:00Z`).toISOString(),
        customerName: 'Cliente Piloto',
        customerPhone: phone,
        channel,
      });
    await book('10:00', `11${RUN.slice(-8)}1`, 'marketplace');
    await book('11:00', `11${RUN.slice(-8)}1`, 'marketplace');
    await book('12:00', `11${RUN.slice(-8)}2`);
    const m = await pilot.metrics(7, CITY);
    expect(m).toMatchObject({
      marketplaceBookings: 2,
      marketplaceNewClients: 1,
      directBookings: 1,
    });
  });
});
