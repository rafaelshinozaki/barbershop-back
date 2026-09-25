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
    await prisma.clientAccount.deleteMany({ where: { email: { contains: `-${RUN}@` } } });
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

    it('agendar logado com o telefone de uma ficha existente não liga a ficha à conta', async () => {
      // Antes a ficha achada pelo telefone digitado passava pra conta logada —
      // e com ela o histórico de outra pessoa
      const phone = `11${RUN}77`;
      const victim = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Vítima', phone },
      });
      const account = await prisma.clientAccount.create({
        data: { email: `logado-${RUN}@test.local`, name: 'Logado', password: null },
      });
      await service.createPublicAppointment({
        barbershopId: A.shopId,
        barberId: A.barberId,
        serviceIds: [A.serviceId],
        startAt: at(day, '16:30').toISOString(),
        customerName: 'Logado',
        customerPhone: phone,
        clientAccountId: account.id,
      });
      const after = await prisma.customer.findUnique({ where: { id: victim.id } });
      expect(after!.clientAccountId).toBeNull();

      // Telefone novo: a ficha criada já nasce na conta de quem agendou
      await service.createPublicAppointment({
        barbershopId: A.shopId,
        barberId: A.barberId,
        serviceIds: [A.serviceId],
        startAt: at(day, '17:00').toISOString(),
        customerName: 'Logado',
        customerPhone: `11${RUN}78`,
        clientAccountId: account.id,
      });
      const own = await prisma.customer.findFirst({ where: { phone: `11${RUN}78` } });
      expect(own!.clientAccountId).toBe(account.id);
    });

    it('duas pessoas reservando o mesmo horário ao mesmo tempo: só uma consegue', async () => {
      const startAt = at(day, '15:00').toISOString();
      const attempt = (n: number) =>
        service.createPublicAppointment({
          barbershopId: A.shopId,
          barberId: A.barberId,
          serviceIds: [A.serviceId],
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
      const before = await service.getPublicAvailableSlots(
        A.shopId,
        A.barberId,
        [A.serviceId],
        day,
      );
      expect(before.length).toBeGreaterThan(0);
      // de 15 em 15 minutos
      const gap = new Date(before[1]).getTime() - new Date(before[0]).getTime();
      expect(gap).toBe(15 * 60000);

      await book(at(day, '10:00'));
      const after = await service.getPublicAvailableSlots(A.shopId, A.barberId, [A.serviceId], day);
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
      const slots = await service.getPublicAvailableSlots(A.shopId, A.barberId, [A.serviceId], day);
      expect(slots).toContain(at(day, '11:30').toISOString());
      expect(slots).not.toContain(at(day, '11:45').toISOString()); // 11:45–12:15 invade o intervalo
      expect(slots).not.toContain(at(day, '12:30').toISOString());
      expect(slots).toContain(at(day, '13:00').toISOString());
      expect(slots[0]).toBe(at(day, '09:00').toISOString());
    });
  });

  // ============ Qualquer profissional + vários serviços ============

  describe('página pública: qualquer profissional e vários serviços', () => {
    let barbaId: number;
    let n = 0;
    const publicBook = (startAt: Date, barberId: number | null, serviceIds = [A.serviceId]) =>
      service.createPublicAppointment({
        barbershopId: A.shopId,
        barberId,
        serviceIds,
        startAt: startAt.toISOString(),
        customerName: 'Cliente Online',
        customerPhone: `12${RUN}${++n}`,
      });

    beforeAll(async () => {
      barbaId = (
        await prisma.barbershopService.create({
          data: {
            barbershopId: A.shopId,
            name: 'Barba',
            durationMinutes: 20,
            price: new Decimal(30),
            depositAmount: new Decimal(10),
          },
        })
      ).id;
    });

    it('vários serviços: duração somada nos horários e no agendamento, preço de cada um', async () => {
      await book(at(day, '10:00'));
      const one = await service.getPublicAvailableSlots(A.shopId, A.barberId, [A.serviceId], day);
      const both = await service.getPublicAvailableSlots(
        A.shopId,
        A.barberId,
        [A.serviceId, barbaId],
        day,
      );
      // 09:30 + 30 min cabe antes das 10:00; + 50 min não
      expect(one).toContain(at(day, '09:30').toISOString());
      expect(both).not.toContain(at(day, '09:30').toISOString());
      expect(both).toContain(at(day, '09:00').toISOString());

      const appt = await publicBook(at(day, '14:00'), A.barberId, [A.serviceId, barbaId]);
      expect(appt!.endAt.toISOString()).toBe(at(day, '14:50').toISOString());
      expect(appt!.services.map((s) => [s.serviceId, Number(s.unitPrice)])).toEqual([
        [A.serviceId, 50],
        [barbaId, 30],
      ]);
      expect(Number(appt!.depositAmount)).toBe(10);
    });

    it('serviço repetido conta uma vez; nenhum, de outra unidade ou inexistente é recusado', async () => {
      const slots = await service.getPublicAvailableSlots(
        A.shopId,
        A.barberId,
        [A.serviceId, A.serviceId],
        day,
      );
      expect(slots).toEqual(
        await service.getPublicAvailableSlots(A.shopId, A.barberId, [A.serviceId], day),
      );
      await expect(publicBook(at(day, '14:00'), A.barberId, [])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const other = await prisma.barbershopService.create({
        data: { barbershopId: B.shopId, name: 'De fora', durationMinutes: 30, price: 10 },
      });
      await expect(
        publicBook(at(day, '14:00'), A.barberId, [A.serviceId, other.id]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('qualquer profissional: horário vale se alguém está livre; o sistema escolhe quem', async () => {
      await book(at(day, '10:00')); // Barbeiro A ocupado às 10:00
      const slots = await service.getPublicAvailableSlots(A.shopId, null, [A.serviceId], day);
      expect(slots).toContain(at(day, '10:00').toISOString()); // o A2 está livre

      const first = await publicBook(at(day, '10:00'), null);
      expect(first!.barberId).toBe(A.otherBarberId);

      // Agora os dois estão ocupados às 10:00
      const after = await service.getPublicAvailableSlots(A.shopId, null, [A.serviceId], day);
      expect(after).not.toContain(at(day, '10:00').toISOString());
      await expect(publicBook(at(day, '10:00'), null)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('qualquer profissional: vai pra quem tem menos horários no dia', async () => {
      await book(at(day, '09:00'));
      await book(at(day, '09:30'));
      const a = await publicBook(at(day, '15:00'), null);
      expect(a!.barberId).toBe(A.otherBarberId);
      const b = await publicBook(at(day, '16:00'), null);
      expect(b!.barberId).toBe(A.otherBarberId); // 2 x 1 ainda
      const c = await publicBook(at(day, '17:00'), null);
      expect(c!.barberId).toBe(A.barberId); // empate: o primeiro
    });

    it('próximo horário disponível: do profissional escolhido ou o mais cedo entre todos', async () => {
      const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
      // Barbeiro A não atende segunda: o dele é na terça; qualquer um, na segunda (o A2)
      await prisma.barberSchedule.create({
        data: {
          barberId: A.barberId,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '18:00',
          isActive: false,
        },
      });
      const mine = await service.getPublicNextAvailableSlot(
        A.shopId,
        A.barberId,
        [A.serviceId],
        day,
      );
      const tuesday = await service.getPublicAvailableSlots(
        A.shopId,
        A.barberId,
        [A.serviceId],
        nextDay,
      );
      expect(mine).toEqual({ date: nextDay, startAt: tuesday[0] });

      const anyone = await service.getPublicNextAvailableSlot(A.shopId, null, [A.serviceId], day);
      const monday = await service.getPublicAvailableSlots(A.shopId, null, [A.serviceId], day);
      expect(anyone).toEqual({ date: day, startAt: monday[0] });

      // O primeiro horário do A2 ocupado: o próximo passa a ser o seguinte
      await book(new Date(monday[0]), { barberId: A.otherBarberId });
      const after = await service.getPublicNextAvailableSlot(A.shopId, null, [A.serviceId], day);
      expect(after!.startAt > monday[0]).toBe(true);

      // Data no passado conta a partir de hoje (nunca devolve horário que já passou)
      const past = await service.getPublicNextAvailableSlot(
        A.shopId,
        null,
        [A.serviceId],
        '2020-01-01',
      );
      expect(new Date(past!.startAt).getTime()).toBeGreaterThan(Date.now());
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

  // ============ Assinatura e pacotes do cliente: cliques simultâneos ============

  describe('assinatura e pacotes do cliente', () => {
    it('dois cliques em "assinar" criam UMA assinatura no Stripe', async () => {
      const created: string[] = [];
      const stripe = {
        attachPaymentMethod: async () => undefined,
        setDefaultPaymentMethod: async () => undefined,
        createSubscription: async (_c: string, _p: string, _m: unknown, key: string) => {
          // Simula a latência do Stripe (é aí que os cliques se cruzavam)
          await new Promise((r) => setTimeout(r, 50));
          created.push(key);
          return {
            id: `sub_dup_${RUN}_${created.length}`,
            status: 'active',
            current_period_start: 1,
            current_period_end: 2,
            latest_invoice: null,
          };
        },
      };
      const svc = new BarbershopService(
        prisma,
        {} as never,
        {} as never,
        { isConfigured: () => false } as never,
        stripe as never,
        {} as never,
        { notify: () => undefined } as never,
      );
      const client = await prisma.clientAccount.create({
        data: { email: `dup-${RUN}@test.local`, name: 'Cliente', stripeCustomerId: 'cus_dup' },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Mensal',
          price: new Decimal(80),
          stripePriceId: 'price_dup',
        },
      });
      const results = await Promise.allSettled(
        [1, 2, 3].map(() => svc.subscribeToPlan(client.id, A.shopId, plan.id, 'pm_x')),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(created).toEqual([`client-sub:${client.id}:${plan.id}:1`]);
      expect(await prisma.clientSubscription.count({ where: { clientAccountId: client.id } })).toBe(
        1,
      );

      // Sessões: limite 2, cinco débitos ao mesmo tempo → só 2 passam
      await prisma.clientSubscriptionPlan.update({
        where: { id: plan.id },
        data: { sessionsPerCycle: 2 },
      });
      const sub = await prisma.clientSubscription.findFirstOrThrow({
        where: { clientAccountId: client.id },
      });
      const redeems = await Promise.allSettled(
        [1, 2, 3, 4, 5].map(() =>
          service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id),
        ),
      );
      expect(redeems.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      expect(
        (await prisma.clientSubscription.findUniqueOrThrow({ where: { id: sub.id } }))
          .usedThisCycle,
      ).toBe(2);

      await prisma.clientSubscription.deleteMany({ where: { clientAccountId: client.id } });
      await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
      await prisma.clientAccount.delete({ where: { id: client.id } });
    });

    it('pacote de 3 sessões: cinco débitos simultâneos usam 3 e o pacote fecha', async () => {
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote 3',
          totalSessions: 3,
          price: new Decimal(120),
        },
      });
      const pkg = await prisma.clientPackage.create({
        data: {
          barbershopId: A.shopId,
          customerId: A.customerId,
          servicePackageId: offer.id,
          totalSessions: 3,
        },
      });
      const debits = await Promise.allSettled(
        [1, 2, 3, 4, 5].map(() => service.debitClientPackageSession(A.ownerId, A.shopId, pkg.id)),
      );
      expect(debits.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
      const after = await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(after).toMatchObject({ usedSessions: 3, status: 'COMPLETED' });

      await prisma.clientPackage.delete({ where: { id: pkg.id } });
      await prisma.servicePackage.delete({ where: { id: offer.id } });
    });
  });

  // ============ Cargos: dono / gerente / barbeiro ============

  describe('cargos na unidade', () => {
    let managerUserId: number;
    const denied = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(ForbiddenException);

    let receptionUserId: number;
    let basicUserId: number;
    let basicBarberId: number;
    let receptionBarberId: number;
    let strangerId: number;

    beforeAll(async () => {
      const role = await prisma.role.findFirstOrThrow({ where: { name: 'BarbershopOwner' } });
      managerUserId = (await createUser('gerente', role.id)).id;
      await prisma.barber.create({
        data: {
          barbershopId: A.shopId,
          name: 'Gerente A',
          phone: '11944444444',
          userId: managerUserId,
          staffType: 'manager',
        },
      });
      receptionUserId = (await createUser('recepcao', role.id)).id;
      receptionBarberId = (
        await prisma.barber.create({
          data: {
            barbershopId: A.shopId,
            name: 'Recepção A',
            phone: '11955555555',
            userId: receptionUserId,
            staffType: 'reception',
          },
        })
      ).id;
      basicUserId = (await createUser('basico', role.id)).id;
      basicBarberId = (
        await prisma.barber.create({
          data: {
            barbershopId: A.shopId,
            name: 'Básico A',
            phone: '11966666666',
            userId: basicUserId,
            staffType: 'basic',
          },
        })
      ).id;
      // Cliente que nunca agendou com o barbeiro A
      strangerId = (
        await prisma.customer.create({
          data: {
            networkId: A.networkId,
            name: `Desconhecido ${RUN}`,
            phone: `119${RUN}`.slice(0, 13),
            email: `desconhecido-${RUN}@test.local`,
          },
        })
      ).id;
    });

    it('barbeiro atende, mas não mexe em financeiro, preços, equipe nem apaga a unidade', async () => {
      const barber = A.staffUserId;
      await expect(service.getCustomers(barber, A.shopId)).resolves.toBeTruthy();
      await expect(service.getServices(barber, A.shopId)).resolves.toBeTruthy();
      expect(await service.getMyAccessLevel(barber, A.shopId)).toBe('barber');

      await denied(service.getExpenses(barber, A.shopId));
      await denied(service.getFinancialSummary(barber, A.shopId, new Date(0), new Date()));
      await denied(service.updateService(barber, A.shopId, A.serviceId, { price: 1 }));
      await denied(service.deleteCustomer(barber, A.shopId, A.customerId));
      await denied(service.getCashSessions(barber, A.shopId));
      await denied(service.deleteBarber(barber, A.shopId, A.otherBarberId));
      await denied(service.deleteBarbershop(barber, A.shopId));
      // Rede: o barbeiro não vê o faturamento das unidades
      expect((await service.getNetworkDashboardStats(barber)).totalBarbershops).toBe(0);
    });

    it('barbeiro (o "Staffer" do Booksy): só a própria agenda; contato só de quem agendou com ele', async () => {
      const barber = A.staffUserId;
      const own = (await book(at(day, '11:00'), { userId: barber }))!;
      const other = (await book(at(day, '11:00'), { barberId: A.otherBarberId }))!;

      // Agenda: só a dele, mesmo pedindo a do colega
      const seen = (await service.getAppointments(barber, A.shopId, { limit: 500 })).map(
        (a) => a.id,
      );
      expect(seen).toContain(own.id);
      expect(seen).not.toContain(other.id);
      const asked = await service.getAppointments(barber, A.shopId, {
        barberId: A.otherBarberId,
        limit: 500,
      });
      expect(asked.every((a) => a.barberId === A.barberId)).toBe(true);
      await expect(service.getAppointment(barber, A.shopId, other.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.updateAppointment(barber, A.shopId, other.id, { notes: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await denied(
        service.updateAppointment(barber, A.shopId, own.id, { barberId: A.otherBarberId }),
      );
      await denied(book(at(day, '11:30'), { userId: barber, barberId: A.otherBarberId }));
      const networkSeen = (await service.getNetworkAppointments(barber)).map((a) => a.id);
      expect(networkSeen).toContain(own.id);
      expect(networkSeen).not.toContain(other.id);

      // Clientes: vê o contato de quem agendou com ele; dos outros, só o nome
      const customer = await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } });
      const stranger = await prisma.customer.findUniqueOrThrow({ where: { id: strangerId } });
      const listed = await service.getCustomers(barber, A.shopId, { limit: 500 });
      expect(listed.find((c) => c.id === A.customerId)).toMatchObject({ phone: customer.phone });
      expect(listed.find((c) => c.id === strangerId)).toMatchObject({
        name: stranger.name,
        phone: '',
        email: null,
      });
      expect(await service.getCustomer(barber, A.shopId, strangerId)).toMatchObject({
        phone: '',
        email: null,
      });
      expect((await service.getAppointment(barber, A.shopId, own.id)).customer).toMatchObject({
        phone: customer.phone,
      });
      // Busca por telefone não serve pra confirmar o de ninguém
      expect(await service.getCustomers(barber, A.shopId, { search: stranger.phone })).toEqual([]);

      // O dono vê tudo
      expect(
        (await service.getAppointments(A.ownerId, A.shopId, { limit: 500 })).map((a) => a.id),
      ).toEqual(expect.arrayContaining([own.id, other.id]));
      expect(await service.getCustomer(A.ownerId, A.shopId, A.customerId)).toMatchObject({
        phone: customer.phone,
      });

      await prisma.appointmentService.deleteMany({
        where: { appointmentId: { in: [own.id, other.id] } },
      });
      await prisma.appointment.deleteMany({ where: { id: { in: [own.id, other.id] } } });
    });

    it('barbeiro básico: só a própria agenda, clientes só pelo nome, sem vendas, fila nem lista de espera', async () => {
      const basic = basicUserId;
      expect(await service.getMyAccessLevel(basic, A.shopId)).toBe('basic');
      const own = (await book(at(day, '14:00'), { userId: basic, barberId: basicBarberId }))!;
      const other = (await book(at(day, '14:00'), { barberId: A.otherBarberId }))!;
      const seen = (await service.getAppointments(basic, A.shopId, { limit: 500 })).map(
        (a) => a.id,
      );
      expect(seen).toContain(own.id);
      expect(seen).not.toContain(other.id);
      await denied(book(at(day, '14:30'), { userId: basic, barberId: A.otherBarberId }));

      // Nem do próprio cliente vê o contato
      expect((await service.getAppointment(basic, A.shopId, own.id)).customer).toMatchObject({
        phone: '',
        email: null,
      });
      const listed = await service.getCustomers(basic, A.shopId, { limit: 500 });
      expect(listed.every((c) => c.phone === '' && c.email === null)).toBe(true);
      // Cadastra cliente (na hora de agendar)
      const created = await service.createCustomer(basic, A.shopId, {
        name: 'Novo pelo básico',
        phone: '11977776666',
      });
      expect(created.id).toBeTruthy();

      await denied(service.getSales(basic, A.shopId));
      await denied(
        service.createSale(basic, A.shopId, {
          barberId: basicBarberId,
          saleType: 'SERVICE',
          items: [],
          subtotal: 10,
          total: 10,
        }),
      );
      await denied(service.getWalkIns(basic, A.shopId));
      await denied(service.getWaitlistEntries(basic, A.shopId));
      await denied(service.getCurrentCashSession(basic, A.shopId));

      await prisma.appointmentService.deleteMany({
        where: { appointmentId: { in: [own.id, other.id] } },
      });
      await prisma.appointment.deleteMany({ where: { id: { in: [own.id, other.id] } } });
      await prisma.customer.delete({ where: { id: created.id } });
    });

    it('recepção: agenda de todos, cadastro completo dos clientes e o caixa; sem relatórios nem configurações', async () => {
      const reception = receptionUserId;
      expect(await service.getMyAccessLevel(reception, A.shopId)).toBe('reception');
      // Agenda de todos: marca pra qualquer barbeiro, mas ela mesma não atende
      const forOther = (await book(at(day, '15:30'), {
        userId: reception,
        barberId: A.otherBarberId,
      }))!;
      await expect(
        book(at(day, '15:30'), { userId: reception, barberId: receptionBarberId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        (await service.getAppointments(reception, A.shopId, { limit: 500 })).map((a) => a.id),
      ).toContain(forOther.id);
      await expect(
        service.updateAppointment(reception, A.shopId, forOther.id, { notes: 'confirmado' }),
      ).resolves.toBeTruthy();

      // Clientes: vê o contato de todos, busca por telefone e edita
      const stranger = await prisma.customer.findUniqueOrThrow({ where: { id: strangerId } });
      expect(await service.getCustomer(reception, A.shopId, strangerId)).toMatchObject({
        phone: stranger.phone,
      });
      expect(
        (await service.getCustomers(reception, A.shopId, { search: stranger.phone })).map(
          (c) => c.id,
        ),
      ).toEqual([strangerId]);
      await expect(
        service.updateCustomer(reception, A.shopId, strangerId, { notes: 'prefere manhã' }),
      ).resolves.toBeTruthy();
      await denied(service.deleteCustomer(reception, A.shopId, strangerId));

      // Vendas de todos (é quem fecha a conta no balcão), sem editar/apagar
      const sale = await service.createSale(reception, A.shopId, {
        barberId: A.otherBarberId,
        saleType: 'SERVICE',
        items: [],
        subtotal: 10,
        total: 10,
      });
      const sales = (await service.getSales(reception, A.shopId)) as any;
      expect((Array.isArray(sales) ? sales : sales.items).map((x: any) => x.id)).toContain(sale.id);
      await denied(service.deleteSale(reception, A.shopId, sale.id));

      // Fora: relatórios, despesas, histórico do caixa, catálogo, equipe, horários
      await denied(service.getExpenses(reception, A.shopId));
      await denied(service.getFinancialSummary(reception, A.shopId, new Date(0), new Date()));
      await denied(service.getCashSessions(reception, A.shopId));
      await denied(service.getAdvancedReports(reception, A.shopId, new Date(0), new Date()));
      await denied(service.updateService(reception, A.shopId, A.serviceId, { price: 1 }));
      await denied(service.deleteBarber(reception, A.shopId, A.otherBarberId));
      await denied(
        service.createBarberTimeOff(reception, {
          barberId: A.otherBarberId,
          startAt: at(day, '08:00').toISOString(),
          endAt: at(day, '08:30').toISOString(),
        }),
      );
      expect((await service.getNetworkDashboardStats(reception)).totalBarbershops).toBe(0);
      // Na rede, vê a agenda da unidade inteira — com os nomes (sem telefone)
      const network = await service.getNetworkAppointments(reception);
      expect(network.map((a) => a.id)).toContain(forOther.id);
      const seen = network.find((a) => a.id === forOther.id)!;
      expect(seen.customerName).toEqual(expect.any(String));
      expect(seen.barberName).toEqual(expect.any(String));
      expect(seen.customer).not.toHaveProperty('phone');

      await prisma.appointmentService.deleteMany({ where: { appointmentId: forOther.id } });
      await prisma.appointment.delete({ where: { id: forOther.id } });
    });

    it('recepção não aparece pra agendar na página pública', async () => {
      const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: A.shopId } });
      const pub = await service.getPublicBarbershopByslug(shop.slug);
      const ids = pub.barbers.map((b: { id: number }) => b.id);
      expect(ids).toContain(basicBarberId);
      expect(ids).not.toContain(receptionBarberId);
    });

    it('página pública: "Sobre nós" e horário de funcionamento da semana', async () => {
      const shop = await prisma.barbershop.findUniqueOrThrow({ where: { id: A.shopId } });
      await service.updateBarbershop(A.ownerId, A.shopId, { description: '  Desde 2015.  ' });
      await expect(
        service.updateBarbershop(A.ownerId, A.shopId, { description: 'x'.repeat(1001) }),
      ).rejects.toThrow('no máximo 1000');
      const pub = await service.getPublicBarbershopByslug(shop.slug);
      expect(pub.description).toBe('Desde 2015.');
      expect(pub.openingHours).toHaveLength(7);
      expect(pub.openingHours[1]).toMatchObject({ dayOfWeek: 1, open: expect.any(String) });
      expect(pub.portfolio).toEqual([]);
      // WhatsApp e redes: normaliza, e só aceita link da própria rede
      await service.updateBarbershop(A.ownerId, A.shopId, {
        whatsapp: '(12) 99757-2011',
        instagramUrl: '@green.barber',
        facebookUrl: 'facebook.com/greenbarber',
        linkedinUrl: 'https://www.linkedin.com/company/green',
      });
      expect(await service.getPublicBarbershopByslug(shop.slug)).toMatchObject({
        whatsapp: '+5512997572011',
        instagramUrl: 'https://instagram.com/green.barber',
        facebookUrl: 'https://facebook.com/greenbarber',
        linkedinUrl: 'https://www.linkedin.com/company/green',
      });
      await expect(
        service.updateBarbershop(A.ownerId, A.shopId, { facebookUrl: 'https://golpe.com/x' }),
      ).rejects.toThrow('Use um link do Facebook');
      await expect(
        service.updateBarbershop(A.ownerId, A.shopId, { whatsapp: '123' }),
      ).rejects.toThrow('WhatsApp inválido');
      await service.updateBarbershop(A.ownerId, A.shopId, {
        whatsapp: '',
        instagramUrl: '',
        facebookUrl: '',
        linkedinUrl: '',
      });
      expect((await service.getPublicBarbershopByslug(shop.slug)).whatsapp).toBeNull();
      await service.updateBarbershop(A.ownerId, A.shopId, { description: '' });
      expect((await service.getPublicBarbershopByslug(shop.slug)).description).toBeNull();
    });

    it('barbeiro mexe só na própria folga', async () => {
      const barber = A.staffUserId;
      const own = await service.createBarberTimeOff(barber, {
        barberId: A.barberId,
        startAt: at(day, '08:00').toISOString(),
        endAt: at(day, '08:30').toISOString(),
      });
      await service.deleteBarberTimeOff(barber, own.id);
      await denied(
        service.createBarberTimeOff(barber, {
          barberId: A.otherBarberId,
          startAt: at(day, '08:00').toISOString(),
          endAt: at(day, '08:30').toISOString(),
        }),
      );
    });

    it('barbeiro vê só as próprias vendas; o dono vê todas', async () => {
      const own = await service.createSale(A.staffUserId, A.shopId, {
        barberId: A.barberId,
        saleType: 'SERVICE',
        items: [],
        subtotal: 10,
        total: 10,
      });
      const other = await service.createSale(A.ownerId, A.shopId, {
        barberId: A.otherBarberId,
        saleType: 'SERVICE',
        items: [],
        subtotal: 10,
        total: 10,
      });
      const seenByBarber = (await service.getSales(A.staffUserId, A.shopId)) as { id: number }[];
      const ids = (
        Array.isArray(seenByBarber) ? seenByBarber : (seenByBarber as any).items ?? []
      ).map((x: { id: number }) => x.id);
      expect(ids).toContain(own.id);
      expect(ids).not.toContain(other.id);
      const seenByOwner = (await service.getSales(A.ownerId, A.shopId)) as any;
      const ownerIds = (Array.isArray(seenByOwner) ? seenByOwner : seenByOwner.items ?? []).map(
        (x: { id: number }) => x.id,
      );
      expect(ownerIds).toEqual(expect.arrayContaining([own.id, other.id]));
    });

    it('gerente (como no Booksy) faz quase tudo do dono: caixa, relatórios, comissões; só apagar a unidade é do dono', async () => {
      expect(await service.getMyAccessLevel(managerUserId, A.shopId)).toBe('manager');
      await expect(
        service.updateService(managerUserId, A.shopId, A.serviceId, { price: 55 }),
      ).resolves.toBeTruthy();
      await expect(service.getCashSessions(managerUserId, A.shopId)).resolves.toBeTruthy();
      await expect(service.getNetworkDashboardStats(managerUserId)).resolves.toMatchObject({
        totalBarbershops: 1,
      });
      // Gerente toca o caixa: despesas e resumo da unidade
      await expect(service.getExpenses(managerUserId, A.shopId)).resolves.toBeTruthy();
      // Relatório avançado depende do plano, não do cargo
      await service
        .getAdvancedReports(managerUserId, A.shopId, new Date(0), new Date())
        .catch((e) => expect(e.message).not.toMatch(/cargo/));
      const rule = await service.setCommissionRule(managerUserId, A.shopId, { percentage: 10 });
      await service.deleteCommissionRule(managerUserId, A.shopId, rule.id);
      // Contato dos clientes: gerente vê
      expect((await service.getCustomer(managerUserId, A.shopId, A.customerId)).phone).not.toBe('');
      await denied(service.deleteBarbershop(managerUserId, A.shopId));

      expect(await service.getMyAccessLevel(A.ownerId, A.shopId)).toBe('owner');
      await expect(service.getExpenses(A.ownerId, A.shopId)).resolves.toBeTruthy();
    });

    it('funcionário desligado perde o acesso', async () => {
      await prisma.barber.updateMany({
        where: { userId: managerUserId },
        data: { isActive: false },
      });
      await denied(service.getCustomers(managerUserId, A.shopId));
      expect(await service.getMyAccessLevel(managerUserId, A.shopId)).toBeNull();
      expect(await service.getUserBarbershops(managerUserId)).toEqual([]);
    });
  });
});
