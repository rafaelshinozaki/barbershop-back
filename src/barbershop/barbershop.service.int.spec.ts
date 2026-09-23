/**
 * Testes de integração do núcleo do negócio (agenda, horários, vendas e
 * acesso entre franquias) contra um Postgres de verdade — mocks do Prisma
 * esconderiam justamente o que importa aqui (sobreposição de horário no
 * banco, transações, corrida entre duas requisições).
 *
 * Usa o DATABASE_URL do ambiente (no CI, o Postgres do workflow, já
 * migrado). Cria duas franquias próprias com sufixo único e apaga tudo no
 * final, então pode rodar contra o banco de desenvolvimento.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// Próxima segunda-feira (dia com expediente no horário padrão), em UTC
function nextMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

// Horário de parede no fuso da unidade (America/Sao_Paulo, UTC-3 sem horário de verão)
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`);

describe('BarbershopService (integração com o banco)', () => {
  const prisma = new PrismaService();
  let service: BarbershopService;

  // Franquia A (a testada) e franquia B (outra empresa)
  const A = {} as {
    ownerId: number;
    staffUserId: number;
    networkId: number;
    shopId: number;
    barberId: number;
    otherBarberId: number;
    serviceId: number;
    customerId: number;
  };
  const B = {} as {
    ownerId: number;
    networkId: number;
    shopId: number;
    barberId: number;
    customerId: number;
  };
  const day = nextMonday();

  async function createUser(label: string, roleId: number) {
    return prisma.user.create({
      data: {
        email: `int-${label}-${RUN}@test.local`,
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
  }

  async function createShop(networkId: number, ownerUserId: number, label: string) {
    return prisma.barbershop.create({
      data: {
        name: `Teste ${label}`,
        slug: `int-${label}-${RUN}`,
        address: 'Rua Teste, 1',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        postalCode: '01000000',
        phone: '11999999999',
        email: `int-${label}-${RUN}@test.local`,
        timezone: 'America/Sao_Paulo',
        networkId,
        ownerUserId,
      },
    });
  }

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    const stub = {} as never;
    service = new BarbershopService(
      prisma,
      stub, // UserService
      stub, // S3Service
      { isConfigured: () => false } as never, // WhatsappService
      stub, // StripeService
      { email: async () => undefined, whatsapp: async () => undefined } as never,
      { notify: () => undefined } as never, // RealtimeService
    );

    const ownerA = await createUser('ownera', role.id);
    const staffA = await createUser('staffa', role.id);
    const ownerB = await createUser('ownerb', role.id);
    A.ownerId = ownerA.id;
    A.staffUserId = staffA.id;
    B.ownerId = ownerB.id;

    const networkA = await prisma.network.create({
      data: {
        ownerUserId: ownerA.id,
        name: `Rede A ${RUN}`,
        loyaltyEnabled: true,
        loyaltyPointsPerCurrencyUnit: 1,
        loyaltyPointValue: 0.1,
      },
    });
    const networkB = await prisma.network.create({
      data: { ownerUserId: ownerB.id, name: `Rede B ${RUN}` },
    });
    A.networkId = networkA.id;
    B.networkId = networkB.id;

    const shopA = await createShop(networkA.id, ownerA.id, 'a');
    const shopB = await createShop(networkB.id, ownerB.id, 'b');
    A.shopId = shopA.id;
    B.shopId = shopB.id;

    A.barberId = (
      await prisma.barber.create({
        data: {
          barbershopId: shopA.id,
          name: 'Barbeiro A',
          phone: '11911111111',
          userId: staffA.id,
        },
      })
    ).id;
    A.otherBarberId = (
      await prisma.barber.create({
        data: { barbershopId: shopA.id, name: 'Barbeiro A2', phone: '11922222222' },
      })
    ).id;
    B.barberId = (
      await prisma.barber.create({
        data: { barbershopId: shopB.id, name: 'Barbeiro B', phone: '11933333333' },
      })
    ).id;
    A.serviceId = (
      await prisma.barbershopService.create({
        data: {
          barbershopId: shopA.id,
          name: 'Corte',
          durationMinutes: 30,
          price: new Decimal(50),
        },
      })
    ).id;
    A.customerId = (
      await prisma.customer.create({
        data: { networkId: networkA.id, name: 'Cliente A', phone: `11${RUN}a`, loyaltyPoints: 100 },
      })
    ).id;
    B.customerId = (
      await prisma.customer.create({
        data: {
          networkId: networkB.id,
          name: 'Cliente B',
          phone: `11${RUN}b`,
          loyaltyPoints: 1000,
        },
      })
    ).id;
  });

  afterAll(async () => {
    const shopIds = [A.shopId, B.shopId].filter(Boolean);
    const networkIds = [A.networkId, B.networkId].filter(Boolean);
    const sales = await prisma.sale.findMany({
      where: { barbershopId: { in: shopIds } },
      select: { id: true },
    });
    await prisma.saleItem.deleteMany({ where: { saleId: { in: sales.map((s) => s.id) } } });
    await prisma.sale.deleteMany({ where: { barbershopId: { in: shopIds } } });
    const appts = await prisma.appointment.findMany({
      where: { barbershopId: { in: shopIds } },
      select: { id: true },
    });
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: appts.map((a) => a.id) } },
    });
    await prisma.appointment.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.giftCard.deleteMany({ where: { networkId: { in: networkIds } } });
    await prisma.customer.deleteMany({ where: { networkId: { in: networkIds } } });
    await prisma.barberSchedule.deleteMany({
      where: { barber: { barbershopId: { in: shopIds } } },
    });
    await prisma.barber.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barbershopService.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.barbershop.deleteMany({ where: { id: { in: shopIds } } });
    await prisma.network.deleteMany({ where: { id: { in: networkIds } } });
    // User tem soft delete (middleware do PrismaService transforma delete em
    // update de deleted_at) — apaga de verdade pra não acumular no banco
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  // Agendamentos criados por cada teste não devem vazar pros outros
  afterEach(async () => {
    const appts = await prisma.appointment.findMany({
      where: { barbershopId: { in: [A.shopId, B.shopId] } },
      select: { id: true },
    });
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: appts.map((a) => a.id) } },
    });
    await prisma.appointment.deleteMany({ where: { id: { in: appts.map((a) => a.id) } } });
    await prisma.barberSchedule.deleteMany({ where: { barberId: A.barberId } });
  });

  const book = (
    startAt: Date,
    opts: Partial<{ barberId: number; customerId: number; minutes: number; userId: number }> = {},
  ) =>
    service.createAppointment(opts.userId ?? A.ownerId, A.shopId, {
      customerId: opts.customerId ?? A.customerId,
      barberId: opts.barberId ?? A.barberId,
      startAt,
      endAt: new Date(startAt.getTime() + (opts.minutes ?? 30) * 60000),
      services: [{ serviceId: A.serviceId, unitPrice: 50 }],
    });

  // ============ Acesso entre franquias ============

  describe('acesso', () => {
    it('dono de outra franquia não mexe na agenda nem nas vendas desta barbearia', async () => {
      await expect(book(at(day, '10:00'), { userId: B.ownerId })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.createSale(B.ownerId, A.shopId, {
          saleType: 'SERVICE',
          items: [],
          subtotal: 10,
          total: 10,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('funcionário da barbearia tem acesso', async () => {
      await expect(book(at(day, '10:00'), { userId: A.staffUserId })).resolves.toBeTruthy();
    });

    it('não agenda cliente de outra franquia', async () => {
      await expect(book(at(day, '10:00'), { customerId: B.customerId })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('não agenda com barbeiro de outra barbearia', async () => {
      await expect(book(at(day, '10:00'), { barberId: B.barberId })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('não registra venda pra cliente de outra franquia (nem resgata os pontos dele)', async () => {
      await expect(
        service.createSale(A.ownerId, A.shopId, {
          customerId: B.customerId,
          saleType: 'SERVICE',
          items: [],
          subtotal: 100,
          total: 100,
          loyaltyPointsRedeemed: 500,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const b = await prisma.customer.findUnique({ where: { id: B.customerId } });
      expect(b?.loyaltyPoints).toBe(1000);
    });
  });

  // ============ Conflito de horário ============

  describe('conflito de horário', () => {
    it('recusa sobreposição no mesmo barbeiro', async () => {
      await book(at(day, '10:00'));
      await expect(book(at(day, '10:15'))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('permite horário encostado (termina 10:30, começa 10:30) e outro barbeiro no mesmo horário', async () => {
      await book(at(day, '10:00'));
      await expect(book(at(day, '10:30'))).resolves.toBeTruthy();
      await expect(book(at(day, '10:00'), { barberId: A.otherBarberId })).resolves.toBeTruthy();
    });

    it('agendamento cancelado libera o horário', async () => {
      const appt = await book(at(day, '11:00'));
      await service.updateAppointment(A.ownerId, A.shopId, appt!.id, { status: 'CANCELLED' });
      await expect(book(at(day, '11:00'))).resolves.toBeTruthy();
    });

    it('duas pessoas reservando o mesmo horário ao mesmo tempo: só uma consegue', async () => {
      const startAt = at(day, '15:00').toISOString();
      const attempt = (n: number) =>
        service.createPublicAppointment({
          barbershopId: A.shopId,
          barberId: A.barberId,
          serviceId: A.serviceId,
          startAt,
          customerName: `Cliente ${n}`,
          customerPhone: `11${RUN}${n}`,
        });
      const results = await Promise.allSettled([1, 2, 3, 4, 5].map(attempt));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const count = await prisma.appointment.count({
        where: { barberId: A.barberId, startAt: new Date(startAt) },
      });
      expect(count).toBe(1);
    });
  });

  // ============ Horários livres (página pública) ============

  describe('horários livres', () => {
    it('grade de 15 em 15 min no expediente, sem o horário ocupado', async () => {
      const before = await service.getPublicAvailableSlots(A.shopId, A.barberId, A.serviceId, day);
      expect(before.length).toBeGreaterThan(0);
      // de 15 em 15 minutos
      const gap = new Date(before[1]).getTime() - new Date(before[0]).getTime();
      expect(gap).toBe(15 * 60000);

      await book(at(day, '10:00'));
      const after = await service.getPublicAvailableSlots(A.shopId, A.barberId, A.serviceId, day);
      // 30 min de serviço: 9:45 e 10:15 também batem no agendamento das 10:00
      for (const t of ['09:45', '10:00', '10:15']) {
        expect(after).not.toContain(at(day, t).toISOString());
      }
      expect(after).toContain(at(day, '09:30').toISOString());
      expect(after).toContain(at(day, '10:30').toISOString());
    });

    it('respeita o intervalo do barbeiro', async () => {
      await prisma.barberSchedule.create({
        data: {
          barberId: A.barberId,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '18:00',
          breakStart: '12:00',
          breakEnd: '13:00',
        },
      });
      const slots = await service.getPublicAvailableSlots(A.shopId, A.barberId, A.serviceId, day);
      expect(slots).toContain(at(day, '11:30').toISOString());
      expect(slots).not.toContain(at(day, '11:45').toISOString()); // 11:45–12:15 invade o intervalo
      expect(slots).not.toContain(at(day, '12:30').toISOString());
      expect(slots).toContain(at(day, '13:00').toISOString());
      expect(slots[0]).toBe(at(day, '09:00').toISOString());
    });
  });

  // ============ Vendas ============

  describe('vendas', () => {
    const sale = (extra: Record<string, unknown> = {}) =>
      service.createSale(A.ownerId, A.shopId, {
        customerId: A.customerId,
        saleType: 'SERVICE',
        items: [
          {
            itemType: 'SERVICE',
            serviceId: A.serviceId,
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
        ],
        subtotal: 100,
        total: 100,
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
        ...extra,
      });

    beforeEach(async () => {
      await prisma.customer.update({ where: { id: A.customerId }, data: { loyaltyPoints: 100 } });
    });

    it('cartão-presente: desconta do total e do saldo do cartão', async () => {
      const card = await prisma.giftCard.create({
        data: {
          networkId: A.networkId,
          code: `INT${RUN}A`,
          initialValue: new Decimal(30),
          remainingValue: new Decimal(30),
        },
      });
      const s = await sale({ giftCardCode: card.code });
      expect(Number(s.total)).toBe(70);
      expect(Number(s.giftCardAmountApplied)).toBe(30);
      const after = await prisma.giftCard.findUnique({ where: { id: card.id } });
      expect(Number(after?.remainingValue)).toBe(0);
    });

    it('cartão-presente de outra franquia não vale', async () => {
      const card = await prisma.giftCard.create({
        data: {
          networkId: B.networkId,
          code: `INT${RUN}B`,
          initialValue: new Decimal(30),
          remainingValue: new Decimal(30),
        },
      });
      await expect(sale({ giftCardCode: card.code })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resgate de pontos: 50 pontos × R$0,10 = R$5 de desconto, e ganha pontos do valor pago', async () => {
      const s = await sale({ loyaltyPointsRedeemed: 50 });
      expect(Number(s.total)).toBe(95);
      const c = await prisma.customer.findUnique({ where: { id: A.customerId } });
      // 100 - 50 resgatados + 95 ganhos (1 ponto por real pago)
      expect(c?.loyaltyPoints).toBe(145);
    });

    it('não resgata mais pontos do que o cliente tem', async () => {
      await expect(sale({ loyaltyPointsRedeemed: 101 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('duas vendas ao mesmo tempo não resgatam os mesmos pontos duas vezes', async () => {
      const results = await Promise.allSettled([
        sale({ loyaltyPointsRedeemed: 80, paymentStatus: 'PENDING' }),
        sale({ loyaltyPointsRedeemed: 80, paymentStatus: 'PENDING' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const c = await prisma.customer.findUnique({ where: { id: A.customerId } });
      expect(c?.loyaltyPoints).toBe(20);
    });

    it('venda pendente não dá pontos', async () => {
      await sale({ paymentStatus: 'PENDING' });
      const c = await prisma.customer.findUnique({ where: { id: A.customerId } });
      expect(c?.loyaltyPoints).toBe(100);
    });
  });
});
