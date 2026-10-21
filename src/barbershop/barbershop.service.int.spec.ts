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
import { currentPricing } from '../pricing/pricing';
import { PrismaService } from '../prisma/prisma.service';
import {
  BarbershopService,
  NETWORK_AGENDA_CAP,
  assertStaffAppointmentSource,
  WALK_IN_TRANSITION_MESSAGE,
  CLUB_UNDO_OLD_CYCLE_MESSAGE,
  SALE_APPOINTMENT_CUSTOMER_MESSAGE,
  SALE_BELOW_APPLIED_MESSAGE,
  CUSTOMER_HAS_PACKAGES_MESSAGE,
  APPOINTMENT_DEPOSIT_MESSAGE,
  DEPOSIT_RECEPTION_MESSAGE,
  DEPOSIT_METHOD_MESSAGE,
  DEPOSIT_CASH_CLOSED_MESSAGE,
} from './barbershop.service';

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
        isActive: true,
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
    await prisma.chatThread.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.appointmentTip.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.noShowFee.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.professionalReview.deleteMany({ where: { barbershopId: { in: shopIds } } });
    await prisma.customerRating.deleteMany({ where: { barbershopId: { in: shopIds } } });
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
    const ids = appts.map((a) => a.id);
    await prisma.chatThread.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.appointmentTip.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.noShowFee.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.professionalReview.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.customerRating.deleteMany({ where: { appointmentId: { in: ids } } });
    await prisma.appointmentService.deleteMany({
      where: { appointmentId: { in: ids } },
    });
    await prisma.appointment.deleteMany({ where: { id: { in: ids } } });
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
          subtotal: 0,
          total: 0,
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

    it('não agenda com profissional inativo nem cliente apagado', async () => {
      await prisma.barber.update({ where: { id: A.otherBarberId }, data: { isActive: false } });
      try {
        await expect(book(at(day, '10:00'), { barberId: A.otherBarberId })).rejects.toBeInstanceOf(
          NotFoundException,
        );
      } finally {
        await prisma.barber.update({ where: { id: A.otherBarberId }, data: { isActive: true } });
      }
      const gone = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Apagado', phone: `6${RUN}`, deletedAt: new Date() },
      });
      await expect(book(at(day, '10:00'), { customerId: gone.id })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('não registra venda pra cliente de outra franquia (nem resgata os pontos dele)', async () => {
      await expect(
        service.createSale(A.ownerId, A.shopId, {
          customerId: B.customerId,
          saleType: 'SERVICE',
          items: [],
          subtotal: 0,
          total: 0,
          loyaltyPointsRedeemed: 500,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const b = await prisma.customer.findUnique({ where: { id: B.customerId } });
      expect(b?.loyaltyPoints).toBe(1000);
    });

    it('editar venda não troca cliente/profissional por um de outra franquia', async () => {
      const own = await service.createSale(A.ownerId, A.shopId, {
        customerId: A.customerId,
        saleType: 'SERVICE',
        items: [],
        subtotal: 0,
        total: 0,
      });
      for (const change of [{ customerId: B.customerId }, { barberId: B.barberId }]) {
        await expect(
          service.updateSale(A.ownerId, A.shopId, own.id, change),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
      const after = await prisma.sale.findUniqueOrThrow({ where: { id: own.id } });
      expect(after.customerId).toBe(A.customerId);
      await prisma.sale.delete({ where: { id: own.id } });
    });

    it('pacote e plano recusam sessão zero ou preço negativo', async () => {
      await expect(
        service.createServicePackage(A.ownerId, A.shopId, {
          serviceId: A.serviceId,
          name: 'Pacote vazio',
          totalSessions: 0,
          price: 10,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createSubscriptionPlan(A.ownerId, A.shopId, {
          serviceId: A.serviceId,
          name: 'Plano negativo',
          price: -5,
          sessionsPerCycle: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('editar a venda acerta estoque e pontos', async () => {
      const product = await prisma.barbershopProduct.create({
        data: {
          barbershopId: A.shopId,
          name: `Pomada ${RUN}`,
          salePrice: new Decimal(20),
        },
      });
      await prisma.inventoryItem.create({
        data: { barbershopId: A.shopId, productId: product.id, quantity: 10 },
      });
      const before = (await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } }))
        .loyaltyPoints;
      const item = (quantity: number, total: number) => ({
        itemType: 'PRODUCT',
        productId: product.id,
        quantity,
        unitPrice: 20,
        totalPrice: total,
      });
      const sale = await service.createSale(A.ownerId, A.shopId, {
        customerId: A.customerId,
        saleType: 'PRODUCT',
        items: [item(2, 40)],
        subtotal: 40,
        total: 40,
        paymentStatus: 'PAID',
      });
      expect(Number((await stock()).quantity)).toBe(8);
      expect(await points()).toBe(before + 40);

      await service.updateSale(A.ownerId, A.shopId, sale.id, {
        items: [item(1, 20)],
        subtotal: 20,
        total: 20,
      });
      expect(Number((await stock()).quantity)).toBe(9);
      expect(await points()).toBe(before + 20);
      expect(
        (await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } })).loyaltyPointsEarned,
      ).toBe(20);

      await service.updateSale(A.ownerId, A.shopId, sale.id, { paymentStatus: 'PENDING' });
      expect(await points()).toBe(before);
      expect(Number((await stock()).quantity)).toBe(9);

      // Vendas do mesmo produto ao mesmo tempo: nenhuma baixa se perde
      await Promise.all(
        [1, 2, 3, 4].map(() =>
          service.createSale(A.ownerId, A.shopId, {
            saleType: 'PRODUCT',
            items: [item(1, 20)],
            subtotal: 20,
            total: 20,
          }),
        ),
      );
      expect(Number((await stock()).quantity)).toBe(5);
      const moves = await prisma.inventoryMovement.findMany({
        where: { inventoryItemId: (await stock()).id, notes: null, movementType: 'SALE' },
        orderBy: { quantityAfter: 'desc' },
      });
      expect(moves.slice(-4).map((m) => Number(m.quantityAfter))).toEqual([8, 7, 6, 5]);

      async function stock() {
        return prisma.inventoryItem.findUniqueOrThrow({
          where: { barbershopId_productId: { barbershopId: A.shopId, productId: product.id } },
        });
      }
      async function points() {
        return (await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } }))
          .loyaltyPoints;
      }
    });

    it('fila de espera: não põe cliente de outra franquia nem mexe na fila de outra unidade', async () => {
      const walkIn = (customerId: number, barberId?: number) =>
        service.createWalkIn(A.ownerId, A.shopId, {
          customerId,
          barberId,
          customerName: 'Fila',
          services: [{ serviceId: A.serviceId }],
        });
      // A resposta traria a ficha (telefone, e-mail) do cliente da outra empresa
      await expect(walkIn(B.customerId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(walkIn(A.customerId, B.barberId)).rejects.toBeInstanceOf(NotFoundException);
      const own = await walkIn(A.customerId);
      await expect(
        service.updateWalkInStatus(B.ownerId, B.shopId, own.id, 'CANCELLED'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.updateWalkInStatus(A.ownerId, A.shopId, own.id, 'QUALQUER'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.walkIn.findUniqueOrThrow({ where: { id: own.id } })).status).toBe(
        'WAITING',
      );
      await expect(
        service.updateWalkInStatus(A.ownerId, A.shopId, own.id, 'IN_PROGRESS'),
      ).resolves.toMatchObject({ status: 'IN_PROGRESS' });
      await prisma.walkInService.deleteMany({ where: { walkInId: own.id } });
      await prisma.walkIn.delete({ where: { id: own.id } });
    });

    it('fila: barbeiro pega quem está sem profissional, a troca segue uma ordem e a fila é do dia (itens 215 e 216)', async () => {
      const entry = (barberId?: number) =>
        service.createWalkIn(A.ownerId, A.shopId, {
          customerId: A.customerId,
          barberId,
          customerName: 'Fila do dia',
          services: [{ serviceId: A.serviceId }],
        });
      const free = await entry();
      // O barbeiro começa o atendimento de quem está sem profissional e vira o profissional
      const started = await service.updateWalkInStatus(
        A.staffUserId,
        A.shopId,
        free.id,
        'IN_PROGRESS',
      );
      expect(started).toMatchObject({ status: 'IN_PROGRESS', barberId: A.barberId });
      await expect(
        service.updateWalkInStatus(A.staffUserId, A.shopId, free.id, 'COMPLETED'),
      ).resolves.toMatchObject({ status: 'COMPLETED' });
      // Concluído não volta para a fila
      await expect(
        service.updateWalkInStatus(A.ownerId, A.shopId, free.id, 'WAITING'),
      ).rejects.toThrow(WALK_IN_TRANSITION_MESSAGE);

      // A recepção escolhe quem atende; o de outro profissional o barbeiro não vê
      const other = await entry();
      await service.updateWalkInStatus(
        A.ownerId,
        A.shopId,
        other.id,
        'IN_PROGRESS',
        A.otherBarberId,
      );
      await expect(
        service.updateWalkInStatus(A.staffUserId, A.shopId, other.id, 'COMPLETED'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Voltar para a fila vai para o fim, não para a posição antiga
      const back = await entry();
      const returned = await service.updateWalkInStatus(A.ownerId, A.shopId, other.id, 'WAITING');
      expect(returned.queuePosition).toBeGreaterThan(back.queuePosition);

      // Entrada de ontem não aparece, não conta no número e a rotina fecha
      const yesterday = await entry();
      await prisma.walkIn.update({
        where: { id: yesterday.id },
        data: { createdAt: new Date(Date.now() - 2 * 86_400_000), queuePosition: 99 },
      });
      const list = await service.getWalkIns(A.ownerId, A.shopId);
      expect(list.map((w) => w.id)).not.toContain(yesterday.id);
      const next = await entry();
      expect(next.queuePosition).toBeLessThan(99);
      await service.closeStaleWalkIns();
      expect((await prisma.walkIn.findUniqueOrThrow({ where: { id: yesterday.id } })).status).toBe(
        'NOT_SERVED',
      );
      expect((await prisma.walkIn.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
        'WAITING',
      );

      const ids = [free, other, back, yesterday, next].map((w) => w.id);
      await prisma.walkInService.deleteMany({ where: { walkInId: { in: ids } } });
      await prisma.walkIn.deleteMany({ where: { id: { in: ids } } });
    });

    it('pacote não é vendido pra cliente de outra franquia', async () => {
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote X',
          totalSessions: 3,
          price: new Decimal(90),
        },
      });
      await expect(
        service.purchaseClientPackage(A.ownerId, A.shopId, {
          customerId: B.customerId,
          servicePackageId: offer.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.clientPackage.count({ where: { servicePackageId: offer.id } })).toBe(0);
      await prisma.servicePackage.delete({ where: { id: offer.id } });
    });

    it('pacote e cartão-presente vendidos viram venda; pacote só da recepção pra cima', async () => {
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote Venda',
          totalSessions: 4,
          price: new Decimal(120),
        },
      });
      // O plano Basic do teste não tem o módulo de pacotes
      const modules = jest
        .spyOn(service as never as { canAccessModule: () => Promise<boolean> }, 'canAccessModule')
        .mockResolvedValue(true);
      // Barbeiro (nível padrão) não vende pacote
      await expect(
        service.purchaseClientPackage(A.staffUserId, A.shopId, {
          customerId: A.customerId,
          servicePackageId: offer.id,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.purchaseClientPackage(A.ownerId, A.shopId, {
        customerId: A.customerId,
        servicePackageId: offer.id,
        paymentMethod: 'PIX',
      });
      const pkgSale = await prisma.sale.findFirstOrThrow({
        where: { barbershopId: A.shopId, saleType: 'PACKAGE' },
        include: { items: true },
        orderBy: { id: 'desc' },
      });
      expect(pkgSale).toMatchObject({
        customerId: A.customerId,
        paymentStatus: 'PAID',
        paymentMethod: 'PIX',
      });
      expect(Number(pkgSale.total)).toBe(120);
      expect(pkgSale.items[0]).toMatchObject({
        itemType: 'PACKAGE',
        notes: 'Pacote — Pacote Venda',
      });

      // Cartão-presente vendido na unidade, sem a forma: fica pendente
      const card = await service.createGiftCard(A.ownerId, A.networkId, {
        initialValue: 50,
        barbershopId: A.shopId,
      });
      const cardSale = await prisma.sale.findFirstOrThrow({
        where: { barbershopId: A.shopId, saleType: 'GIFT_CARD' },
        include: { items: true },
        orderBy: { id: 'desc' },
      });
      expect(cardSale.paymentStatus).toBe('PENDING');
      expect(cardSale.items[0].notes).toBe(`Cartão-presente ${card.code}`);
      // Unidade de outra rede: recusa
      await expect(
        service.createGiftCard(A.ownerId, A.networkId, {
          initialValue: 50,
          barbershopId: B.shopId,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      await prisma.sale.deleteMany({ where: { id: { in: [pkgSale.id, cardSale.id] } } });
      await prisma.giftCard.delete({ where: { id: card.id } });
      modules.mockRestore();
      await prisma.clientPackage.deleteMany({ where: { servicePackageId: offer.id } });
      await prisma.servicePackage.delete({ where: { id: offer.id } });
    });

    it('pontos de fidelidade incluem o sinal e o pagamento pelo app', async () => {
      const customer = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Pagou no app', phone: `11${RUN}pts` },
      });
      const appt = await book(at(day, '09:30'), { customerId: customer.id });
      await prisma.appointment.update({
        where: { id: appt!.id },
        data: {
          depositAmount: new Decimal(30),
          depositPaid: true,
          prepaidAmount: new Decimal(50),
          prepaidAt: new Date(),
        },
      });
      const sale = await service.createSale(A.ownerId, A.shopId, {
        customerId: customer.id,
        appointmentId: appt!.id,
        saleType: 'SERVICE',
        items: [
          {
            itemType: 'SERVICE',
            serviceId: A.serviceId,
            quantity: 1,
            unitPrice: 80,
            totalPrice: 80,
          },
        ],
        subtotal: 80,
        total: 80,
        paymentStatus: 'PAID',
      });
      // O caixa fica em 0 (30 de sinal + 50 pelo app), mas os pontos saem dos 80
      expect(Number(sale.total)).toBe(0);
      expect(sale.loyaltyPointsEarned).toBe(80);
      const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(after.loyaltyPoints).toBe(80);
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    it('conta do horário: menor que o já pago é recusada e só no cliente do horário (item 225)', async () => {
      const customer = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Pagou 100', phone: `11${RUN}c225` },
      });
      const other = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Outra pessoa', phone: `11${RUN}o225` },
      });
      const appt = await book(at(day, '10:30'), { customerId: customer.id });
      await prisma.appointment.update({
        where: { id: appt!.id },
        data: { prepaidAmount: new Decimal(100), prepaidAt: new Date() },
      });
      const bill = (total: number, customerId?: number) =>
        service.createSale(A.ownerId, A.shopId, {
          customerId,
          appointmentId: appt!.id,
          saleType: 'SERVICE',
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: 1,
              unitPrice: total,
              totalPrice: total,
            },
          ],
          subtotal: total,
          total,
          paymentStatus: 'PAID',
        });
      await expect(bill(60, customer.id)).rejects.toThrow(SALE_BELOW_APPLIED_MESSAGE);
      await expect(bill(100, other.id)).rejects.toThrow(SALE_APPOINTMENT_CUSTOMER_MESSAGE);
      // Sem cliente na venda: vai o do horário
      const sale = await bill(100);
      expect(sale.customerId).toBe(customer.id);
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    it('sinal à mão: recepção para cima, com a forma, dentro do preço e no caixa (item 227)', async () => {
      const make = (over: Record<string, unknown>, userId = A.ownerId) =>
        service.createAppointment(userId, A.shopId, {
          customerId: A.customerId,
          barberId: A.barberId,
          startAt: at(day, '07:00'),
          endAt: at(day, '07:30'),
          services: [{ serviceId: A.serviceId, unitPrice: 50 }],
          ...over,
        } as never);
      await expect(make({ services: [{ serviceId: A.serviceId, unitPrice: -5 }] })).rejects.toThrow(
        'Preço do serviço inválido',
      );
      await expect(
        make({ services: [{ serviceId: A.serviceId, unitPrice: 50, quantity: 0 }] }),
      ).rejects.toThrow('Quantidade inválida');
      await expect(make({ depositAmount: -1 })).rejects.toThrow('Sinal inválido');
      await expect(make({ depositAmount: 80 })).rejects.toThrow(APPOINTMENT_DEPOSIT_MESSAGE);
      // O barbeiro não marca sinal pago, e sem a forma ninguém marca
      await expect(
        make({ depositAmount: 20, depositPaid: true, depositPaymentMethod: 'CASH' }, A.staffUserId),
      ).rejects.toThrow(DEPOSIT_RECEPTION_MESSAGE);
      await expect(make({ depositAmount: 20, depositPaid: true })).rejects.toThrow(
        DEPOSIT_METHOD_MESSAGE,
      );

      // Em dinheiro: entra no caixa aberto e conta no fechamento
      await prisma.cashSession.updateMany({
        where: { barbershopId: A.shopId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      const session = await service.openCashSession(A.ownerId, A.shopId, 0);
      const appt = await make({
        depositAmount: 20,
        depositPaid: true,
        depositPaymentMethod: 'CASH',
      });
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appt!.id } });
      expect(row).toMatchObject({
        depositManualMethod: 'CASH',
        depositReceivedByUserId: A.ownerId,
        depositCashSessionId: session.id,
      });
      const closed = await service.closeCashSession(A.ownerId, A.shopId, { countedBalance: 20 });
      expect(Number(closed.expectedBalance)).toBe(20);
      // Caixa fechado: o sinal não se desmarca mais
      await expect(
        service.setAppointmentDepositPaid(A.ownerId, A.shopId, appt!.id, false),
      ).rejects.toThrow(DEPOSIT_CASH_CLOSED_MESSAGE);
      await prisma.appointment.delete({ where: { id: appt!.id } });
    });

    it('cartão-presente não nasce vencido, e assinatura já cancelada não chama a Stripe', async () => {
      await expect(
        service.createGiftCard(A.ownerId, A.networkId, {
          initialValue: 20,
          expiresAt: new Date('2000-01-01'),
        }),
      ).rejects.toThrow('não pode ser no passado');

      const account = await prisma.clientAccount.create({
        data: { email: `sub-${RUN}@test.local`, name: 'Assinante', password: null },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: `Plano ${RUN}`,
          price: new Decimal(10),
        },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: A.shopId,
          clientAccountId: account.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_${RUN}`,
          status: 'CANCELED',
        },
      });
      await expect(service.cancelMySubscription(account.id, sub.id)).resolves.toBe(true);
      await prisma.clientSubscription.delete({ where: { id: sub.id } });
      await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
      await prisma.clientAccount.delete({ where: { id: account.id } });
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

    it('fim antes do início (ou data inválida) é recusado', async () => {
      // Antes passava e o horário escapava da checagem de conflito
      const start = at(day, '17:00');
      await expect(
        service.createAppointment(A.ownerId, A.shopId, {
          customerId: A.customerId,
          barberId: A.barberId,
          startAt: start,
          endAt: new Date(start.getTime() - 30 * 60000),
          services: [{ serviceId: A.serviceId, unitPrice: 50 }],
        }),
      ).rejects.toThrow('O fim tem que ser depois do início');
      await expect(
        service.createAppointment(A.ownerId, A.shopId, {
          customerId: A.customerId,
          barberId: A.barberId,
          startAt: new Date('abc'),
          endAt: start,
          services: [{ serviceId: A.serviceId, unitPrice: 50 }],
        }),
      ).rejects.toThrow('Horário inválido');
    });

    it('a agenda da equipe só aceita as origens da equipe', () => {
      // HISTORY pela tela furava a cota do plano solo
      expect(() => assertStaffAppointmentSource('HISTORY')).toThrow('Origem');
      expect(() => assertStaffAppointmentSource('ONLINE')).toThrow('Origem');
      expect(() => assertStaffAppointmentSource('IMPORT')).toThrow('Origem');
      expect(() => assertStaffAppointmentSource('PHONE')).not.toThrow();
      expect(() => assertStaffAppointmentSource(undefined)).not.toThrow();
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
      const own = await prisma.customer.findFirst({ where: { phone: { endsWith: `11${RUN}78` } } });
      expect(own!.clientAccountId).toBe(account.id);
    });

    it('guarda por onde o cliente chegou e se é a primeira vez no negócio', async () => {
      const phone = `11${RUN}66`;
      const booking = (time: string, channel?: string) =>
        service.createPublicAppointment({
          barbershopId: A.shopId,
          barberId: A.barberId,
          serviceIds: [A.serviceId],
          startAt: at(day, time).toISOString(),
          customerName: 'Veio da vitrine',
          customerPhone: phone,
          channel,
        });
      const first = await booking('13:00', 'marketplace');
      expect(first).toMatchObject({ bookingChannel: 'marketplace', firstVisit: true });
      // Segunda vez (mesmo telefone): não é mais cliente novo; sem canal = link do negócio
      const second = await booking('13:30');
      expect(second).toMatchObject({ bookingChannel: 'direct', firstVisit: false });
      // Canal desconhecido vira direct (nunca conta como vitrine por engano)
      await service.updateAppointment(A.ownerId, A.shopId, second!.id, { status: 'CANCELLED' });
      const third = await booking('14:00', 'qualquer-coisa');
      expect(third).toMatchObject({ bookingChannel: 'direct', firstVisit: false });
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

    it('o mesmo telefone não marca dois horários ao mesmo tempo nem passa de 5 futuros', async () => {
      const phone = `11${RUN}91`;
      const booking = (time: string, barberId = A.barberId) =>
        service.createPublicAppointment({
          barbershopId: A.shopId,
          barberId,
          serviceIds: [A.serviceId],
          startAt: at(day, time).toISOString(),
          customerName: 'Mesmo cliente',
          customerPhone: phone,
        });
      await booking('10:00');
      await expect(booking('10:00', A.otherBarberId)).rejects.toThrow(
        'Você já tem um horário nesse período',
      );
      // Outra formatação do telefone é a mesma pessoa
      await expect(
        service.createPublicAppointment({
          barbershopId: A.shopId,
          barberId: A.otherBarberId,
          serviceIds: [A.serviceId],
          startAt: at(day, '10:00').toISOString(),
          customerName: 'Mesmo cliente',
          customerPhone: `${phone.slice(0, 4)}-${phone.slice(4)}`,
        }),
      ).rejects.toThrow('Você já tem um horário nesse período');

      for (const time of ['11:00', '12:00', '14:00', '15:00']) await booking(time);
      await expect(booking('16:00', A.otherBarberId)).rejects.toThrow('Você já tem 5 horários');
    });
  });

  // ============ Horários livres (página pública) ============

  describe('horários livres', () => {
    it('antecedência mínima tira o horário perto e recusa na confirmação', async () => {
      await prisma.barbershop.update({
        where: { id: A.shopId },
        data: { minBookingLeadMinutes: 60 },
      });
      try {
        await expect(
          service.createPublicAppointment({
            barbershopId: A.shopId,
            barberId: A.barberId,
            serviceIds: [A.serviceId],
            startAt: new Date(Date.now() + 20 * 60_000).toISOString(),
            customerName: 'Cedo demais',
            customerPhone: '11987654321',
          }),
        ).rejects.toThrow('antecedência');
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        const slots = await service.getPublicAvailableSlots(
          A.shopId,
          A.barberId,
          [A.serviceId],
          today,
        );
        const cutoff = Date.now() + 60 * 60_000;
        expect(slots.every((s) => new Date(s).getTime() > cutoff)).toBe(true);
        await expect(
          service.updateBarbershop(A.ownerId, A.shopId, { minBookingLeadMinutes: 15 }),
        ).rejects.toThrow('Antecedência mínima inválida');
      } finally {
        await prisma.barbershop.update({
          where: { id: A.shopId },
          data: { minBookingLeadMinutes: 0 },
        });
      }
    });

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

  describe('apagar a ficha do cliente', () => {
    it('anonimiza: atendimento, caixinha e avaliação ficam; dados pessoais e ficha técnica saem', async () => {
      const c = await prisma.customer.create({
        data: {
          networkId: A.networkId,
          name: 'Para Apagar',
          phone: `9${RUN}`,
          email: 'apagar@x.test',
          notes: 'alergia',
        },
      });
      const past = await prisma.appointment.create({
        data: {
          barbershopId: A.shopId,
          barberId: A.barberId,
          customerId: c.id,
          startAt: new Date(Date.now() - 3 * 86_400_000),
          endAt: new Date(Date.now() - 3 * 86_400_000 + 1_800_000),
          status: 'COMPLETED',
        },
      });
      await prisma.appointmentTip.create({
        data: {
          appointmentId: past.id,
          barbershopId: A.shopId,
          barberId: A.barberId,
          destination: 'professional',
          method: 'CASH',
          amount: 10,
          currency: 'BRL',
        },
      });
      await prisma.professionalReview.create({
        data: {
          appointmentId: past.id,
          barberId: A.barberId,
          barbershopId: A.shopId,
          customerId: c.id,
          rating: 1,
        },
      });
      await prisma.consentForm.create({
        data: { barbershopId: A.shopId, customerId: c.id, formType: 'ANAMNESIS' },
      });

      // Horário marcado pela frente: pede para cancelar antes
      const future = await prisma.appointment.create({
        data: {
          barbershopId: A.shopId,
          barberId: A.barberId,
          customerId: c.id,
          startAt: new Date(Date.now() + 3 * 86_400_000),
          endAt: new Date(Date.now() + 3 * 86_400_000 + 1_800_000),
          status: 'CONFIRMED',
        },
      });
      await expect(service.deleteCustomer(A.ownerId, A.shopId, c.id)).rejects.toThrow(
        'horários marcados',
      );
      await prisma.appointment.update({ where: { id: future.id }, data: { status: 'CANCELLED' } });

      // Pacote ativo com sessões sobrando: pede para usar ou devolver antes (item 226)
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote ficha',
          totalSessions: 3,
          price: new Decimal(90),
        },
      });
      const pkg = await prisma.clientPackage.create({
        data: {
          barbershopId: A.shopId,
          customerId: c.id,
          servicePackageId: offer.id,
          totalSessions: 3,
          usedSessions: 1,
        },
      });
      await expect(service.deleteCustomer(A.ownerId, A.shopId, c.id)).rejects.toThrow(
        CUSTOMER_HAS_PACKAGES_MESSAGE,
      );
      await prisma.clientPackage.update({ where: { id: pkg.id }, data: { status: 'COMPLETED' } });
      // Pontos e taxa pendente não ficam presos na ficha removida
      await prisma.customer.update({ where: { id: c.id }, data: { loyaltyPoints: 40 } });
      const fee = await prisma.noShowFee.create({
        data: {
          appointmentId: future.id,
          customerId: c.id,
          barbershopId: A.shopId,
          amount: new Decimal(20),
          currency: 'BRL',
          reason: 'NO_SHOW',
        },
      });

      await service.deleteCustomer(A.ownerId, A.shopId, c.id);
      expect((await prisma.noShowFee.findUniqueOrThrow({ where: { id: fee.id } })).status).toBe(
        'WAIVED',
      );
      expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).loyaltyPoints).toBe(
        0,
      );
      const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
      expect(row).toMatchObject({ name: 'Cliente removido', phone: '', email: null, notes: null });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(await prisma.appointment.count({ where: { id: past.id } })).toBe(1);
      expect(await prisma.appointmentTip.count({ where: { appointmentId: past.id } })).toBe(1);
      expect(await prisma.professionalReview.count({ where: { appointmentId: past.id } })).toBe(1);
      expect(await prisma.consentForm.count({ where: { customerId: c.id } })).toBe(0);

      // Some da lista e não abre mais
      const list = await service.getCustomers(A.ownerId, A.shopId, { search: 'Cliente removido' });
      expect(list.find((x: { id: number }) => x.id === c.id)).toBeUndefined();
      await expect(service.getCustomer(A.ownerId, A.shopId, c.id)).rejects.toThrow(
        'Cliente não encontrado',
      );
      await expect(service.deleteCustomer(A.ownerId, A.shopId, c.id)).rejects.toThrow(
        'Cliente não encontrado',
      );
    });
  });

  describe('link de gerenciar com a versão do agendamento', () => {
    it('horário cancelado e reativado continua abrindo pela conta do cliente', async () => {
      process.env.APPOINTMENT_LINK_SECRET ??= 'segredo-de-teste';
      const account = await prisma.clientAccount.create({
        data: { email: `link-${RUN}@test.local`, name: 'Link Versao' },
      });
      const c = await prisma.customer.create({
        data: {
          networkId: A.networkId,
          name: 'Link Versao',
          phone: `8${RUN}`,
          clientAccountId: account.id,
        },
      });
      const appt = await prisma.appointment.create({
        data: {
          barbershopId: A.shopId,
          barberId: A.barberId,
          customerId: c.id,
          startAt: new Date(Date.now() + 5 * 86_400_000),
          endAt: new Date(Date.now() + 5 * 86_400_000 + 1_800_000),
          status: 'CONFIRMED',
          // Já foi cancelado pela unidade uma vez e voltou
          linkVersion: 1,
        },
      });
      try {
        const [item] = await service.getClientUpcomingAppointments(account.id);
        expect(item.id).toBe(appt.id);
        expect(item.manageToken.startsWith(`${appt.id}.1.`)).toBe(true);
        await expect(service.getManagedAppointment(item.manageToken)).resolves.toMatchObject({
          id: appt.id,
        });
      } finally {
        await prisma.appointment.delete({ where: { id: appt.id } });
        await prisma.customer.delete({ where: { id: c.id } });
        await prisma.clientAccount.delete({ where: { id: account.id } });
      }
    });
  });

  describe('vendas', () => {
    it('total que não bate com os itens é recusado', async () => {
      const item = {
        itemType: 'SERVICE',
        serviceId: A.serviceId,
        quantity: 2,
        unitPrice: 50,
        totalPrice: 100,
      };
      // Itens de R$ 100 com total de R$ 1
      await expect(
        service.createSale(A.ownerId, A.shopId, {
          saleType: 'SERVICE',
          items: [item],
          subtotal: 100,
          total: 1,
        }),
      ).rejects.toThrow('total não bate');
      // Subtotal diferente da soma dos itens
      await expect(
        service.createSale(A.ownerId, A.shopId, {
          saleType: 'SERVICE',
          items: [item],
          subtotal: 10,
          total: 10,
        }),
      ).rejects.toThrow('subtotal não bate');
      // Item com valor diferente de quantidade × preço
      await expect(
        service.createSale(A.ownerId, A.shopId, {
          saleType: 'SERVICE',
          items: [{ ...item, totalPrice: 1 }],
          subtotal: 1,
          total: 1,
        }),
      ).rejects.toThrow('quantidade × preço');
    });

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

    it('editar a venda mantém o que o cartão-presente abateu (item 137)', async () => {
      const card = await prisma.giftCard.create({
        data: {
          networkId: A.networkId,
          code: `INT${RUN}E`,
          initialValue: new Decimal(30),
          remainingValue: new Decimal(30),
        },
      });
      const s = await sale({ giftCardCode: card.code, paymentStatus: 'PENDING' });
      expect(Number(s.total)).toBe(70);
      const line = (price: number) => ({
        items: [
          {
            itemType: 'SERVICE',
            serviceId: A.serviceId,
            quantity: 1,
            unitPrice: price,
            totalPrice: price,
          },
        ],
        subtotal: price,
        discountAmount: 0,
        taxAmount: 0,
        total: price,
      });
      // A tela manda o total cheio ao receber: continua 70
      const paid = await service.updateSale(A.ownerId, A.shopId, s.id, {
        ...line(100),
        paymentStatus: 'PAID',
        paymentMethod: 'PIX',
      });
      expect(Number(paid?.total)).toBe(70);
      const cheaper = await service.updateSale(A.ownerId, A.shopId, s.id, line(90));
      expect(Number(cheaper?.total)).toBe(60);
      await expect(service.updateSale(A.ownerId, A.shopId, s.id, line(20))).rejects.toThrow(
        'menor do que já foi pago',
      );
    });

    it('tipo, situação e forma de pagamento só dos valores conhecidos (item 139)', async () => {
      await expect(sale({ saleType: 'REFUND' })).rejects.toThrow('Tipo de venda inválido');
      await expect(sale({ paymentMethod: 'cash' })).rejects.toThrow('Forma de pagamento inválida');
      await expect(sale({ paymentStatus: 'REFUNDED' })).rejects.toThrow(
        'Situação de pagamento inválida',
      );
      await expect(
        sale({
          items: [{ itemType: 'GIFT_CARD', quantity: 1, unitPrice: 100, totalPrice: 100 }],
        }),
      ).rejects.toThrow('Tipo de item inválido');
      const s = await sale();
      await expect(
        service.updateSale(A.ownerId, A.shopId, s.id, { paymentStatus: 'PARTIAL' }),
      ).rejects.toThrow('Situação de pagamento inválida');

      // Venda de pacote "para receber depois": recebe (item 138), mas o tipo não muda
      const pkg = await prisma.sale.create({
        data: {
          barbershopId: A.shopId,
          saleType: 'PACKAGE',
          subtotal: new Decimal(200),
          total: new Decimal(200),
          paymentStatus: 'PENDING',
          items: {
            create: [
              {
                itemType: 'PACKAGE',
                quantity: 1,
                unitPrice: new Decimal(200),
                totalPrice: new Decimal(200),
              },
            ],
          },
        },
      });
      await expect(
        service.updateSale(A.ownerId, A.shopId, pkg.id, { saleType: 'SERVICE' }),
      ).rejects.toThrow('não mudam');
      const received = await service.updateSale(A.ownerId, A.shopId, pkg.id, {
        paymentStatus: 'PAID',
        paymentMethod: 'PIX',
      });
      expect(received?.paymentStatus).toBe('PAID');
      expect(received?.paidAt).not.toBeNull();
      expect(Number(received?.total)).toBe(200);
    });

    it('faturamento soma o sinal, o pago pelo app e o sinal retido (item 146)', async () => {
      const from = new Date(Date.now() - 2 * 86_400_000);
      const to = new Date(Date.now() + 86_400_000);
      const before = await service.getFinancialSummary(A.ownerId, A.shopId, from, to);
      const method = (r: typeof before, key: string) =>
        r.revenueByPaymentMethod.find((m) => m.category === key)?.total ?? 0;
      await prisma.sale.create({
        data: {
          barbershopId: A.shopId,
          saleType: 'SERVICE',
          subtotal: new Decimal(100),
          total: new Decimal(50),
          depositApplied: new Decimal(30),
          prepaidApplied: new Decimal(20),
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          paidAt: new Date(),
        },
      });
      // Faltou e o sinal ficou com a unidade
      await prisma.appointment.create({
        data: {
          barbershopId: A.shopId,
          barberId: A.barberId,
          customerId: A.customerId,
          startAt: new Date(Date.now() - 86_400_000),
          endAt: new Date(Date.now() - 86_400_000 + 1_800_000),
          status: 'NO_SHOW',
          depositPaid: true,
          depositPaidAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000),
          depositAmount: new Decimal(15),
        },
      });
      const after = await service.getFinancialSummary(A.ownerId, A.shopId, from, to);
      expect(Math.round((after.totalRevenue - before.totalRevenue) * 100) / 100).toBe(115);
      expect(method(after, 'DEPOSIT') - method(before, 'DEPOSIT')).toBe(45);
      expect(method(after, 'APP') - method(before, 'APP')).toBe(20);
    });

    it('apagar a venda devolve o saldo do cartão-presente; caixa aberto é um só', async () => {
      const card = await prisma.giftCard.create({
        data: {
          networkId: A.networkId,
          code: `INT${RUN}D`,
          initialValue: new Decimal(40),
          remainingValue: new Decimal(40),
        },
      });
      const s = await sale({ giftCardCode: card.code });
      expect(Number(s.giftCardAmountApplied)).toBe(40);
      await service.deleteSale(A.ownerId, A.shopId, s.id);
      const after = await prisma.giftCard.findUnique({ where: { id: card.id } });
      expect(Number(after?.remainingValue)).toBe(40);

      // Dois cliques em "Abrir caixa": um caixa só
      await prisma.cashSession.updateMany({
        where: { barbershopId: A.shopId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      const opened = await Promise.allSettled([
        service.openCashSession(A.ownerId, A.shopId, 0),
        service.openCashSession(A.ownerId, A.shopId, 0),
      ]);
      expect(opened.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        await prisma.cashSession.count({ where: { barbershopId: A.shopId, status: 'OPEN' } }),
      ).toBe(1);
      await expect(
        service.setCommissionRule(A.ownerId, A.shopId, { percentage: 500 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('venda paga depois entra no caixa em que foi paga; caixa fechado não muda', async () => {
      await prisma.cashSession.updateMany({
        where: { barbershopId: A.shopId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      const first = await service.openCashSession(A.ownerId, A.shopId, 0);
      // Lançada pendente: ainda não está em caixa nenhum
      const pending = await sale({ paymentStatus: 'PENDING' });
      expect(pending.cashSessionId).toBeNull();
      // Paga na hora: no caixa aberto
      const paid = await sale();
      expect(paid.cashSessionId).toBe(first.id);
      await service.closeCashSession(A.ownerId, A.shopId, { countedBalance: 100 });
      const second = await service.openCashSession(A.ownerId, A.shopId, 0);
      // A pendente paga agora em dinheiro: entra no segundo caixa
      const updated = await service.updateSale(A.ownerId, A.shopId, pending.id, {
        paymentStatus: 'PAID',
        paymentMethod: 'CASH',
      });
      expect(updated?.cashSessionId).toBe(second.id);
      const closed = await service.closeCashSession(A.ownerId, A.shopId, { countedBalance: 100 });
      expect(Number(closed.expectedBalance)).toBe(100);

      // A do primeiro caixa (já fechado): não muda valor nem forma, não apaga
      await expect(
        service.updateSale(A.ownerId, A.shopId, paid.id, { paymentMethod: 'PIX' }),
      ).rejects.toThrow('caixa já fechado');
      await expect(service.deleteSale(A.ownerId, A.shopId, paid.id)).rejects.toThrow(
        'caixa já fechado',
      );
      // O que não mexe no dinheiro continua editável
      await expect(
        service.updateSale(A.ownerId, A.shopId, paid.id, {
          paymentMethod: 'CASH',
          paymentStatus: 'PAID',
        }),
      ).resolves.toBeTruthy();
      await service.openCashSession(A.ownerId, A.shopId, 0);
    });

    it('teto de dinheiro acompanha a moeda', async () => {
      await expect(
        service.createExpense(A.ownerId, A.shopId, {
          category: 'OTHER',
          description: 'Acima do real',
          amount: 1_000_001,
        }),
      ).rejects.toThrow('inválido');
      await prisma.barbershop.update({ where: { id: A.shopId }, data: { currency: 'COP' } });
      try {
        const expense = await service.createExpense(A.ownerId, A.shopId, {
          category: 'OTHER',
          description: 'Salário mínimo em peso',
          amount: 1_500_000,
        });
        expect(Number(expense.amount)).toBe(1_500_000);
        await prisma.expense.delete({ where: { id: expense.id } });
        await expect(
          service.createExpense(A.ownerId, A.shopId, {
            category: 'OTHER',
            description: 'Acima do peso',
            amount: 1_000_000_001,
          }),
        ).rejects.toThrow('inválido');
      } finally {
        await prisma.barbershop.update({ where: { id: A.shopId }, data: { currency: 'BRL' } });
      }
    });

    it('despesa de caixa fechado ou do pagamento da equipe não se apaga por fora', async () => {
      await prisma.cashSession.updateMany({
        where: { barbershopId: A.shopId, status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      await service.openCashSession(A.ownerId, A.shopId, 50);
      const expense = await service.createExpense(A.ownerId, A.shopId, {
        category: 'OTHER',
        description: 'Café',
        amount: 10,
        paymentMethod: 'CASH',
      });
      await service.closeCashSession(A.ownerId, A.shopId, { countedBalance: 40 });
      await expect(service.deleteExpense(A.ownerId, A.shopId, expense.id)).rejects.toThrow(
        'caixa já fechado',
      );
      await service.openCashSession(A.ownerId, A.shopId, 0);
      const vale = await prisma.expense.create({
        data: {
          barbershopId: A.shopId,
          category: 'SALARY',
          description: 'Vale',
          amount: 5,
          createdByUserId: A.ownerId,
        },
      });
      await prisma.barberPayEntry.create({
        data: {
          barbershopId: A.shopId,
          barberId: A.barberId,
          type: 'ADVANCE',
          amount: 5,
          method: 'PIX',
          date: new Date(),
          expenseId: vale.id,
          createdByUserId: A.ownerId,
        },
      });
      await expect(service.deleteExpense(A.ownerId, A.shopId, vale.id)).rejects.toThrow(
        'pagamento da equipe',
      );
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

    it('valor negativo não recarrega cartão-presente nem dá pontos', async () => {
      const card = await prisma.giftCard.create({
        data: {
          networkId: A.networkId,
          code: `INT${RUN}N`,
          initialValue: new Decimal(30),
          remainingValue: new Decimal(30),
        },
      });
      // Antes: "debitava" -50 do cartão (saldo ia a 80) e -500 pontos (virava +500)
      for (const extra of [
        { giftCardCode: card.code, subtotal: -50, total: -50 },
        { loyaltyPointsRedeemed: -500 },
        { discountAmount: Number.NaN },
        {
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: -1,
              unitPrice: 100,
              totalPrice: -100,
            },
          ],
        },
      ]) {
        await expect(sale(extra)).rejects.toBeInstanceOf(BadRequestException);
      }
      const own = await sale({ paymentStatus: 'PENDING' });
      await expect(
        service.updateSale(A.ownerId, A.shopId, own.id, { total: -10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        Number(
          (await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } })).remainingValue,
        ),
      ).toBe(30);
      expect(
        (await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } })).loyaltyPoints,
      ).toBe(100);
      await expect(
        service.createExpense(A.ownerId, A.shopId, {
          category: 'OTHER',
          description: 'x',
          amount: -20,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
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

    it('indicação completa quando a venda passa a paga, e venda de R$ 0 não completa', async () => {
      const referrer = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Quem indicou', phone: `7${RUN}`, loyaltyPoints: 0 },
      });
      const referred = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Indicado', phone: `8${RUN}`, loyaltyPoints: 0 },
      });
      const freeCustomer = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Sem gasto', phone: `9${RUN}`, loyaltyPoints: 0 },
      });
      const paidNow = await prisma.customer.create({
        data: { networkId: A.networkId, name: 'Pago na hora', phone: `4${RUN}`, loyaltyPoints: 0 },
      });
      await prisma.customerReferral.createMany({
        data: [referred, freeCustomer, paidNow].map((c) => ({
          networkId: A.networkId,
          referrerId: referrer.id,
          referredId: c.id,
        })),
      });
      const saleIds: number[] = [];
      try {
        const pending = await sale({ customerId: referred.id, paymentStatus: 'PENDING' });
        saleIds.push(pending.id);
        expect(
          (await prisma.customerReferral.findUniqueOrThrow({ where: { referredId: referred.id } }))
            .completedAt,
        ).toBeNull();
        await service.updateSale(A.ownerId, A.shopId, pending.id, {
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
        });
        const done = await prisma.customerReferral.findUniqueOrThrow({
          where: { referredId: referred.id },
        });
        expect(done.completedAt).toBeTruthy();
        expect(done.pointsAwarded).toBe(50);

        const free = await service.createSale(A.ownerId, A.shopId, {
          customerId: freeCustomer.id,
          saleType: 'SERVICE',
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: 1,
              unitPrice: 0,
              totalPrice: 0,
            },
          ],
          subtotal: 0,
          total: 0,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
        });
        saleIds.push(free.id);
        expect(
          (
            await prisma.customerReferral.findUniqueOrThrow({
              where: { referredId: freeCustomer.id },
            })
          ).completedAt,
        ).toBeNull();

        const now = await sale({ customerId: paidNow.id });
        saleIds.push(now.id);
        expect(
          (await prisma.customerReferral.findUniqueOrThrow({ where: { referredId: paidNow.id } }))
            .completedAt,
        ).toBeTruthy();
        expect(
          (await prisma.customer.findUniqueOrThrow({ where: { id: referrer.id } })).loyaltyPoints,
        ).toBe(100);
      } finally {
        for (const id of saleIds) await service.deleteSale(A.ownerId, A.shopId, id);
        await prisma.customer.deleteMany({
          where: { id: { in: [referrer.id, referred.id, freeCustomer.id, paidNow.id] } },
        });
      }
    });

    it('não resgata pontos com a fidelidade desligada', async () => {
      await prisma.network.update({
        where: { id: A.networkId },
        data: { loyaltyEnabled: false },
      });
      try {
        await expect(sale({ loyaltyPointsRedeemed: 50 })).rejects.toThrow('desligado');
        expect(
          (await prisma.customer.findUniqueOrThrow({ where: { id: A.customerId } })).loyaltyPoints,
        ).toBe(100);
      } finally {
        await prisma.network.update({
          where: { id: A.networkId },
          data: { loyaltyEnabled: true },
        });
      }
    });

    it('apagar a venda do pacote ou do cartão desfaz o que não foi usado; o resto se estorna', async () => {
      const modules = jest
        .spyOn(service as never as { canAccessModule: () => Promise<boolean> }, 'canAccessModule')
        .mockResolvedValue(true);
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote Estorno',
          totalSessions: 4,
          price: new Decimal(120),
        },
      });
      try {
        await service.purchaseClientPackage(A.ownerId, A.shopId, {
          customerId: A.customerId,
          servicePackageId: offer.id,
          paymentMethod: 'PIX',
        });
        const unused = await prisma.clientPackage.findFirstOrThrow({
          where: { servicePackageId: offer.id, status: 'ACTIVE' },
        });
        expect(unused.saleId).toBeTruthy();
        await expect(
          service.refundIssuedRemainder(A.ownerId, A.shopId, unused.saleId!),
        ).rejects.toThrow('não foi usado');
        await service.deleteSale(A.ownerId, A.shopId, unused.saleId!);
        expect((await prisma.clientPackage.findUnique({ where: { id: unused.id } }))?.status).toBe(
          'CANCELLED',
        );
        expect(await prisma.sale.findUnique({ where: { id: unused.saleId! } })).toBeNull();

        await service.purchaseClientPackage(A.ownerId, A.shopId, {
          customerId: A.customerId,
          servicePackageId: offer.id,
          paymentMethod: 'PIX',
        });
        const used = await prisma.clientPackage.findFirstOrThrow({
          where: { servicePackageId: offer.id, status: 'ACTIVE' },
        });
        await service.debitClientPackageSession(A.ownerId, A.shopId, used.id);
        await expect(service.deleteSale(A.ownerId, A.shopId, used.saleId!)).rejects.toThrow(
          'já teve sessão usada',
        );
        // O caixa da venda já fechou: o estorno vai pro caixa aberto de hoje
        const usedSale = await prisma.sale.findUniqueOrThrow({ where: { id: used.saleId! } });
        const oldCash = await prisma.cashSession.create({
          data: {
            barbershopId: A.shopId,
            openedByUserId: A.ownerId,
            openingBalance: new Decimal(0),
            status: 'CLOSED',
            closedAt: new Date(),
          },
        });
        await prisma.sale.update({
          where: { id: usedSale.id },
          data: { cashSessionId: oldCash.id },
        });
        await service.refundIssuedRemainder(A.ownerId, A.shopId, used.saleId!);
        // A venda original fica como foi; o estorno é um lançamento de hoje
        const original = await prisma.sale.findUniqueOrThrow({
          where: { id: used.saleId! },
          include: { items: true },
        });
        expect(Number(original.total)).toBe(120);
        const refundSale = await prisma.sale.findFirstOrThrow({
          where: { barbershopId: A.shopId, saleType: 'REFUND', customerId: A.customerId },
          orderBy: { id: 'desc' },
        });
        expect(Number(refundSale.total)).toBe(-90);
        expect(refundSale.paymentMethod).toBe('PIX');
        await expect(service.deleteSale(A.ownerId, A.shopId, refundSale.id)).rejects.toThrow(
          'Estorno não pode',
        );
        await prisma.sale.update({ where: { id: usedSale.id }, data: { cashSessionId: null } });
        await prisma.cashSession.delete({ where: { id: oldCash.id } });
        const afterPkg = await prisma.clientPackage.findUnique({ where: { id: used.id } });
        expect(afterPkg).toMatchObject({ status: 'COMPLETED', usedSessions: 1, totalSessions: 1 });
        await expect(
          service.refundIssuedRemainder(A.ownerId, A.shopId, used.saleId!),
        ).rejects.toThrow('Não sobrou valor');

        const intact = await service.createGiftCard(A.ownerId, A.networkId, {
          initialValue: 80,
          barbershopId: A.shopId,
          paymentMethod: 'CASH',
        });
        const intactRow = await prisma.giftCard.findUniqueOrThrow({ where: { id: intact.id } });
        expect(intactRow.saleId).toBeTruthy();
        await service.deleteSale(A.ownerId, A.shopId, intactRow.saleId!);
        const intactAfter = await prisma.giftCard.findUnique({ where: { id: intact.id } });
        expect(intactAfter).toMatchObject({ isActive: false });
        expect(Number(intactAfter?.remainingValue)).toBe(0);
        expect(await prisma.sale.findUnique({ where: { id: intactRow.saleId! } })).toBeNull();

        const partial = await service.createGiftCard(A.ownerId, A.networkId, {
          initialValue: 100,
          barbershopId: A.shopId,
          paymentMethod: 'CASH',
        });
        const partialRow = await prisma.giftCard.findUniqueOrThrow({ where: { id: partial.id } });
        await sale({
          giftCardCode: partial.code,
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: 1,
              unitPrice: 40,
              totalPrice: 40,
            },
          ],
          subtotal: 40,
          total: 40,
        });
        await expect(service.deleteSale(A.ownerId, A.shopId, partialRow.saleId!)).rejects.toThrow(
          'já foi usado',
        );
        await service.refundIssuedRemainder(A.ownerId, A.shopId, partialRow.saleId!);
        expect(
          Number((await prisma.sale.findUnique({ where: { id: partialRow.saleId! } }))?.total),
        ).toBe(100);
        expect(
          Number(
            (
              await prisma.sale.findFirstOrThrow({
                where: { barbershopId: A.shopId, saleType: 'REFUND' },
                orderBy: { id: 'desc' },
              })
            ).total,
          ),
        ).toBe(-60);
        const cardAfter = await prisma.giftCard.findUnique({ where: { id: partial.id } });
        expect(Number(cardAfter?.remainingValue)).toBe(0);
        expect(cardAfter?.isActive).toBe(false);

        const pending = await service.createGiftCard(A.ownerId, A.networkId, {
          initialValue: 25,
          barbershopId: A.shopId,
        });
        const pendingRow = await prisma.giftCard.findUniqueOrThrow({ where: { id: pending.id } });
        await expect(
          service.updateSale(A.ownerId, A.shopId, pendingRow.saleId!, { total: 1 }),
        ).rejects.toThrow('não pode ser alterado');
        const paid = await service.updateSale(A.ownerId, A.shopId, pendingRow.saleId!, {
          paymentStatus: 'PAID',
          paymentMethod: 'PIX',
        });
        expect(paid?.paymentStatus).toBe('PAID');
        expect(Number(paid?.total)).toBe(25);

        const ordinary = await sale();
        await expect(
          service.refundIssuedRemainder(A.ownerId, A.shopId, ordinary.id),
        ).rejects.toThrow('não é de pacote');
      } finally {
        modules.mockRestore();
      }
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

      // Sessões: limite 2 gravado na assinatura, cinco débitos ao mesmo tempo → só 2 passam
      const sub = await prisma.clientSubscription.findFirstOrThrow({
        where: { clientAccountId: client.id },
      });
      await prisma.clientSubscription.update({
        where: { id: sub.id },
        data: { sessionsPerCycle: 2 },
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

    it('baixa direta do clube: registro, desfazer no mesmo ciclo e recepção para cima (item 222)', async () => {
      const client = await prisma.clientAccount.create({
        data: { email: `clube-uso-${RUN}@test.local`, name: 'Cliente do clube' },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Clube uso',
          price: new Decimal(60),
          stripePriceId: `price_uso_${RUN}`,
        },
      });
      const periodStart = new Date(Date.now() - 86_400_000);
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: A.shopId,
          clientAccountId: client.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_uso_${RUN}`,
          status: 'ACTIVE',
          currentPeriodStart: periodStart,
        },
      });
      try {
        // Barbeiro não dá baixa direta (como no pacote)
        await expect(
          service.redeemClientSubscriptionSession(A.staffUserId, A.shopId, sub.id),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id);
        const [use] = await prisma.clientSubscriptionUse.findMany({
          where: { clientSubscriptionId: sub.id },
        });
        expect(use).toMatchObject({ usedByUserId: A.ownerId, saleId: null });

        // Desfazer devolve a sessão e não desfaz duas vezes
        await service.undoClientSubscriptionUse(A.ownerId, A.shopId, use.id);
        expect(
          (await prisma.clientSubscription.findUniqueOrThrow({ where: { id: sub.id } }))
            .usedThisCycle,
        ).toBe(0);
        await expect(
          service.undoClientSubscriptionUse(A.ownerId, A.shopId, use.id),
        ).rejects.toThrow('já foi desfeita');

        // Baixa de um ciclo que acabou não volta
        await service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id);
        const old = await prisma.clientSubscriptionUse.findFirstOrThrow({
          where: { clientSubscriptionId: sub.id, undoneAt: null },
        });
        await prisma.clientSubscription.update({
          where: { id: sub.id },
          data: { currentPeriodStart: new Date(), usedThisCycle: 0 },
        });
        await expect(
          service.undoClientSubscriptionUse(A.ownerId, A.shopId, old.id),
        ).rejects.toThrow(CLUB_UNDO_OLD_CYCLE_MESSAGE);
      } finally {
        await prisma.clientSubscription.deleteMany({ where: { id: sub.id } });
        await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
        await prisma.clientAccount.delete({ where: { id: client.id } });
      }
    });

    it('limite do plano vale pra quem assinar depois; vazio volta a ilimitado', async () => {
      const client = await prisma.clientAccount.create({
        data: { email: `limite-${RUN}@test.local`, name: 'Limite', stripeCustomerId: 'cus_limite' },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Mensal limite',
          price: new Decimal(40),
          sessionsPerCycle: 2,
          stripeProductId: `prod_limite_${RUN}`,
          stripePriceId: `price_limite_${RUN}`,
        },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: A.shopId,
          clientAccountId: client.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_limite_${RUN}`,
          status: 'ACTIVE',
          sessionsPerCycle: 2,
        },
      });
      try {
        await service.updateSubscriptionPlan(A.ownerId, A.shopId, plan.id, {
          sessionsPerCycle: null,
        });
        expect(
          (await prisma.clientSubscriptionPlan.findUniqueOrThrow({ where: { id: plan.id } }))
            .sessionsPerCycle,
        ).toBeNull();
        expect(
          (await prisma.clientSubscription.findUniqueOrThrow({ where: { id: sub.id } }))
            .sessionsPerCycle,
        ).toBe(2);
        await service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id);
        await service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id);
        await expect(
          service.redeemClientSubscriptionSession(A.ownerId, A.shopId, sub.id),
        ).rejects.toThrow('não tem sessões');
      } finally {
        await prisma.clientSubscription.deleteMany({ where: { clientAccountId: client.id } });
        await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
        await prisma.clientAccount.delete({ where: { id: client.id } });
      }
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

    it('fechar a conta com sessão do clube zera o serviço e baixa o ciclo', async () => {
      const before = await prisma.customer.findUniqueOrThrow({
        where: { id: A.customerId },
        select: { clientAccountId: true },
      });
      expect(await service.getCustomerSubscriptions(A.ownerId, A.shopId, A.customerId)).toEqual([]);
      const account = await prisma.clientAccount.create({
        data: { email: `club-${RUN}@test.local`, name: 'Clube', emailVerifiedAt: new Date() },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Clube Corte',
          price: new Decimal(80),
          sessionsPerCycle: 1,
        },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: A.shopId,
          clientAccountId: account.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_club_${RUN}`,
          status: 'ACTIVE',
          sessionsPerCycle: 1,
        },
      });
      let saleId: number | null = null;
      try {
        await prisma.customer.update({
          where: { id: A.customerId },
          data: { clientAccountId: account.id },
        });
        const listed = await service.getCustomerSubscriptions(A.ownerId, A.shopId, A.customerId);
        expect(listed).toEqual([
          expect.objectContaining({
            id: sub.id,
            serviceId: A.serviceId,
            usedThisCycle: 0,
            sessionsPerCycle: 1,
          }),
        ]);
        const paid = {
          customerId: A.customerId,
          saleType: 'SERVICE',
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: 1,
              unitPrice: 40,
              totalPrice: 40,
            },
          ],
          subtotal: 40,
          total: 40,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          barberId: A.barberId,
          clientSubscriptionId: sub.id,
        };
        await expect(service.createSale(A.ownerId, A.shopId, paid)).rejects.toThrow('sem cobrar');
        const sale = await service.createSale(A.ownerId, A.shopId, {
          ...paid,
          items: [{ ...paid.items[0], unitPrice: 0, totalPrice: 0 }],
          subtotal: 0,
          total: 0,
        });
        saleId = sale.id;
        expect(Number(sale.total)).toBe(0);
        expect(
          (await prisma.clientSubscription.findUniqueOrThrow({ where: { id: sub.id } }))
            .usedThisCycle,
        ).toBe(1);
        // Quem atendeu recebe comissão sobre o preço do serviço (antes: zero)
        const servicePrice = Number(
          (await prisma.barbershopService.findUniqueOrThrow({ where: { id: A.serviceId } })).price,
        );
        const rule = await prisma.commissionRule.create({
          data: {
            barbershopId: A.shopId,
            barberId: A.barberId,
            itemType: 'SERVICE',
            percentage: 50,
          },
        });
        try {
          const report = await service.computeCommissions(
            A.shopId,
            new Date(Date.now() - 60_000),
            new Date(Date.now() + 60_000),
          );
          const row = report.rows.find((r) => r.barberId === A.barberId);
          expect(row?.serviceCommission).toBeCloseTo(servicePrice / 2);
          expect(row?.totalServiceSales).toBe(0);
        } finally {
          await prisma.commissionRule.delete({ where: { id: rule.id } });
        }
        await expect(
          service.createSale(A.ownerId, A.shopId, {
            ...paid,
            items: [{ ...paid.items[0], unitPrice: 0, totalPrice: 0 }],
            subtotal: 0,
            total: 0,
          }),
        ).rejects.toThrow('não tem sessões');
      } finally {
        if (saleId) {
          await prisma.saleItem.deleteMany({ where: { saleId } });
          await prisma.sale.delete({ where: { id: saleId } });
        }
        await prisma.customer.update({
          where: { id: A.customerId },
          data: { clientAccountId: before.clientAccountId },
        });
        await prisma.clientSubscription.deleteMany({ where: { id: sub.id } });
        await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
        await prisma.clientAccount.delete({ where: { id: account.id } });
      }
    });

    it('assinatura com conta conectada manda o dinheiro pra unidade', async () => {
      const extra: unknown[] = [];
      const stripe = {
        attachPaymentMethod: async () => undefined,
        setDefaultPaymentMethod: async () => undefined,
        createSubscription: async (
          _c: string,
          _p: string,
          _m: unknown,
          _key: string,
          params: unknown,
        ) => {
          extra.push(params);
          return {
            id: `sub_dest_${RUN}`,
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
        data: { email: `dest-${RUN}@test.local`, name: 'Destino', stripeCustomerId: 'cus_dest' },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Mensal Connect',
          price: new Decimal(80),
          stripePriceId: 'price_dest',
        },
      });
      const account = await prisma.paymentAccount.create({
        data: {
          ownerType: 'barbershop',
          ownerId: A.shopId,
          provider: 'stripe',
          stripeAccountId: `acct_dest_${RUN}`,
          chargesEnabled: true,
        },
      });
      try {
        await svc.subscribeToPlan(client.id, A.shopId, plan.id, 'pm_dest');
        const fee = currentPricing().platformFeePercent;
        expect(extra).toEqual([
          { transfer_data: { destination: account.stripeAccountId }, application_fee_percent: fee },
        ]);
        const sub = await prisma.clientSubscription.findFirstOrThrow({
          where: { clientAccountId: client.id },
        });
        expect(sub.connectAccountId).toBe(account.stripeAccountId);
        expect(Number(sub.applicationFeePercent)).toBe(fee);
      } finally {
        await prisma.clientSubscription.deleteMany({ where: { clientAccountId: client.id } });
        await prisma.paymentAccount.delete({ where: { id: account.id } });
        await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
        await prisma.clientAccount.delete({ where: { id: client.id } });
      }
    });

    it('relatório de assinatura tira o que já caiu na conta e o repasse registrado', async () => {
      const before = await service.getSubscriptionRevenueReport(A.ownerId, A.shopId);
      const client = await prisma.clientAccount.create({
        data: { email: `repasse-${RUN}@test.local`, name: 'Repasse' },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Mensal Repasse',
          price: new Decimal(80),
          stripePriceId: `price_repasse_${RUN}`,
        },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: A.shopId,
          clientAccountId: client.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_repasse_${RUN}`,
          status: 'ACTIVE',
          connectAccountId: `acct_repasse_${RUN}`,
          applicationFeePercent: new Decimal(10),
        },
      });
      try {
        await prisma.clientSubscriptionPayment.create({
          data: {
            subscriptionId: sub.id,
            stripeInvoiceId: `in_connect_${RUN}`,
            amount: new Decimal(100),
            platformFeePercent: new Decimal(10),
            settledViaConnect: true,
            status: 'SUCCEEDED',
          },
        });
        await prisma.clientSubscriptionPayment.create({
          data: {
            subscriptionId: sub.id,
            stripeInvoiceId: `in_plat_${RUN}`,
            amount: new Decimal(80),
            platformFeePercent: new Decimal(10),
            status: 'SUCCEEDED',
          },
        });
        await prisma.subscriptionPayout.create({
          data: {
            barbershopId: A.shopId,
            amount: new Decimal(20),
            paidAt: new Date(),
            recordedByEmail: 'fin@test.local',
          },
        });
        const after = await service.getSubscriptionRevenueReport(A.ownerId, A.shopId);
        expect(after.grossAmount - before.grossAmount).toBe(180);
        expect(after.platformFeeAmount - before.platformFeeAmount).toBe(18);
        expect((after.paidOutAutomatically ?? 0) - (before.paidOutAutomatically ?? 0)).toBe(90);
        expect((after.paidOutManually ?? 0) - (before.paidOutManually ?? 0)).toBe(20);
        // 80 da plataforma, menos 10% e menos os 20 já pagos
        expect(after.netOwedToBarbershop - before.netOwedToBarbershop).toBe(52);
      } finally {
        await prisma.subscriptionPayout.deleteMany({
          where: { barbershopId: A.shopId, recordedByEmail: 'fin@test.local' },
        });
        await prisma.clientSubscriptionPayment.deleteMany({ where: { subscriptionId: sub.id } });
        await prisma.clientSubscription.delete({ where: { id: sub.id } });
        await prisma.clientSubscriptionPlan.delete({ where: { id: plan.id } });
        await prisma.clientAccount.delete({ where: { id: client.id } });
      }
    });

    it('fechar a conta com sessão do pacote zera o serviço e apagar a venda devolve', async () => {
      const modules = jest
        .spyOn(service as never as { canAccessModule: () => Promise<boolean> }, 'canAccessModule')
        .mockResolvedValue(true);
      const offer = await prisma.servicePackage.create({
        data: {
          barbershopId: A.shopId,
          serviceId: A.serviceId,
          name: 'Pacote Conta',
          totalSessions: 2,
          price: new Decimal(80),
          validityDays: 30,
        },
      });
      let checkoutSaleId: number | null = null;
      let issuedSaleId: number | null = null;
      let clientPackageId: number | null = null;
      try {
        const bought = await service.purchaseClientPackage(A.ownerId, A.shopId, {
          customerId: A.customerId,
          servicePackageId: offer.id,
          paymentMethod: 'PIX',
        });
        clientPackageId = bought.id;
        issuedSaleId = bought.saleId ?? null;
        expect(bought.expiresAt).toBeTruthy();
        expect(new Date(bought.expiresAt!).getTime()).toBeGreaterThan(Date.now());

        await expect(
          service.debitClientPackageSession(A.staffUserId, A.shopId, bought.id),
        ).rejects.toBeInstanceOf(ForbiddenException);

        const paid = {
          customerId: A.customerId,
          saleType: 'SERVICE',
          items: [
            {
              itemType: 'SERVICE',
              serviceId: A.serviceId,
              quantity: 1,
              unitPrice: 40,
              totalPrice: 40,
            },
          ],
          subtotal: 40,
          total: 40,
          paymentStatus: 'PAID',
          paymentMethod: 'CASH',
          barberId: A.barberId,
          clientPackageId: bought.id,
        };
        await expect(service.createSale(A.ownerId, A.shopId, paid)).rejects.toThrow('sem cobrar');
        const sale = await service.createSale(A.ownerId, A.shopId, {
          ...paid,
          items: [{ ...paid.items[0], unitPrice: 0, totalPrice: 0 }],
          subtotal: 0,
          total: 0,
        });
        checkoutSaleId = sale.id;
        expect(Number(sale.total)).toBe(0);
        const afterUse = await prisma.clientPackage.findUniqueOrThrow({ where: { id: bought.id } });
        expect(afterUse.usedSessions).toBe(1);
        // Sessão do pacote: comissão sobre o que o cliente pagou por sessão (80 / 2)
        const rule = await prisma.commissionRule.create({
          data: {
            barbershopId: A.shopId,
            barberId: A.barberId,
            itemType: 'SERVICE',
            percentage: 50,
          },
        });
        try {
          const report = await service.computeCommissions(
            A.shopId,
            new Date(Date.now() - 60_000),
            new Date(Date.now() + 60_000),
          );
          expect(report.rows.find((r) => r.barberId === A.barberId)?.serviceCommission).toBeCloseTo(
            20,
          );
        } finally {
          await prisma.commissionRule.delete({ where: { id: rule.id } });
        }
        const use = await prisma.clientPackageUse.findFirstOrThrow({
          where: { clientPackageId: bought.id, saleId: sale.id, undoneAt: null },
        });
        expect(use.usedByUserId).toBe(A.ownerId);
        await expect(service.undoClientPackageUse(A.ownerId, A.shopId, use.id)).rejects.toThrow(
          'Apague a venda',
        );

        await service.deleteSale(A.ownerId, A.shopId, sale.id);
        checkoutSaleId = null;
        const restored = await prisma.clientPackage.findUniqueOrThrow({ where: { id: bought.id } });
        expect(restored.usedSessions).toBe(0);
        expect(restored.status).toBe('ACTIVE');
        expect(
          (await prisma.clientPackageUse.findUniqueOrThrow({ where: { id: use.id } })).undoneAt,
        ).toBeTruthy();

        await service.debitClientPackageSession(A.ownerId, A.shopId, bought.id);
        const manual = await prisma.clientPackageUse.findFirstOrThrow({
          where: { clientPackageId: bought.id, saleId: null, undoneAt: null },
        });
        expect(manual.usedByUserId).toBe(A.ownerId);
        await service.undoClientPackageUse(A.ownerId, A.shopId, manual.id);
        expect(
          (await prisma.clientPackage.findUniqueOrThrow({ where: { id: bought.id } })).usedSessions,
        ).toBe(0);

        await prisma.clientPackage.update({
          where: { id: bought.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
        await expect(
          service.createSale(A.ownerId, A.shopId, {
            ...paid,
            items: [{ ...paid.items[0], unitPrice: 0, totalPrice: 0 }],
            subtotal: 0,
            total: 0,
          }),
        ).rejects.toThrow('venceu');
      } finally {
        modules.mockRestore();
        if (checkoutSaleId) {
          await prisma.saleItem.deleteMany({ where: { saleId: checkoutSaleId } });
          await prisma.sale.delete({ where: { id: checkoutSaleId } });
        }
        if (clientPackageId) {
          await prisma.clientPackage.delete({ where: { id: clientPackageId } });
        }
        if (issuedSaleId) {
          await prisma.saleItem.deleteMany({ where: { saleId: issuedSaleId } });
          await prisma.sale.delete({ where: { id: issuedSaleId } });
        }
        await prisma.servicePackage.delete({ where: { id: offer.id } });
      }
    });
  });

  // ============ Cargos: dono / gerente / barbeiro ============

  describe('tipo de estabelecimento', () => {
    let shopId: number;
    const slug = `int-btype-${RUN}`;
    beforeAll(async () => {
      shopId = (await createShop(A.networkId, A.ownerId, 'btype')).id;
    });
    afterAll(async () => {
      await prisma.barbershop.delete({ where: { id: shopId } });
    });

    it('página pública mostra a política de cancelamento da rede', async () => {
      const page = await service.getPublicBarbershopByslug(slug);
      expect(page.cancellationPolicy).toMatchObject({ windowHours: 24, feeEnabled: false });
    });

    it('unidade nova é barbearia; muda pra salão, aparece na página e filtra a busca', async () => {
      expect(
        (await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } })).businessType,
      ).toBe('barbershop');
      await expect(
        service.updateBarbershop(A.ownerId, shopId, { businessType: 'padaria' }),
      ).rejects.toThrow('Tipo de estabelecimento inválido');

      const updated = await service.updateBarbershop(A.ownerId, shopId, {
        businessType: 'beauty_salon',
      });
      expect(updated.businessType).toBe('beauty_salon');
      expect((await service.getPublicBarbershopByslug(slug)).businessType).toBe('beauty_salon');

      const salons = await service.searchPublicBarbershops({
        businessType: 'beauty_salon',
        limit: 500,
      });
      expect(salons.map((r) => r.slug)).toContain(slug);
      expect(salons.every((r) => r.businessType === 'beauty_salon')).toBe(true);
      const barbershops = await service.searchPublicBarbershops({
        businessType: 'barbershop',
        limit: 500,
      });
      expect(barbershops.map((r) => r.slug)).not.toContain(slug);

      // Unidade apagada entre as duas consultas da busca: sai do resultado,
      // a busca não cai (antes o "must" derrubava a busca inteira)
      const original = prisma.barbershop.findMany.bind(prisma.barbershop);
      let calls = 0;
      const spy = jest.spyOn(prisma.barbershop, 'findMany').mockImplementation(((
        args: Parameters<typeof original>[0],
      ) => {
        calls++;
        if (calls !== 2) return original(args);
        return original(args).then((rows) =>
          (rows as Array<{ id: number }>).filter((r) => r.id !== shopId),
        );
      }) as never);
      try {
        const results = await service.searchPublicBarbershops({
          businessType: 'beauty_salon',
          limit: 500,
        });
        expect(calls).toBe(2);
        expect(results.map((r) => r.slug)).not.toContain(slug);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('vagas do plano: só quem atende ocupa', () => {
    // Unidade só deste teste; dono sem assinatura = plano Basic (3 vagas)
    let shopId: number;
    const phone = (n: number) => `1197${RUN}`.slice(0, 9) + String(n).padStart(2, '0');
    beforeAll(async () => {
      shopId = (await createShop(A.networkId, A.ownerId, 'seats')).id;
    });
    afterAll(async () => {
      await prisma.barber.deleteMany({ where: { barbershopId: shopId } });
      await prisma.barbershop.delete({ where: { id: shopId } });
    });

    it('recepção/gerente sem agenda e o dono que atende não ocupam vaga; quem passa a atender ocupa', async () => {
      const add = (n: number, takesAppointments?: boolean) =>
        service.createBarber(A.ownerId, shopId, {
          name: `Vaga ${n}`,
          phone: phone(n),
          takesAppointments,
        });
      const first = await add(1);
      await add(2);
      // Equipe que só administra: não conta
      const admin = await add(3, false);
      await add(4, false);
      // O dono cadastrado como quem atende ("Eu também atendo"): não conta
      await prisma.barber.create({
        data: {
          barbershopId: shopId,
          userId: A.ownerId,
          name: 'Dono',
          phone: phone(5),
          staffType: 'manager',
        },
      });
      expect(await service.getPlanSeatUsage(A.ownerId, shopId)).toEqual({ used: 2, limit: 3 });

      await add(6); // 3ª vaga
      await expect(add(7)).rejects.toBeInstanceOf(BadRequestException);
      // Quem só administra ligar "atende" também esbarra no limite
      await expect(
        service.updateBarber(A.ownerId, shopId, admin.id, { takesAppointments: true }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Desativar libera a vaga; reativar confere o plano de novo (antes não conferia)
      await service.deleteBarber(A.ownerId, shopId, first.id);
      const serving = await service.updateBarber(A.ownerId, shopId, admin.id, {
        takesAppointments: true,
      });
      expect(serving.takesAppointments).toBe(true);
      await expect(service.reactivateBarber(A.ownerId, shopId, first.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(await service.getPlanSeatUsage(A.ownerId, shopId)).toEqual({ used: 3, limit: 3 });

      // Deixar de atender libera a vaga
      await service.updateBarber(A.ownerId, shopId, admin.id, { takesAppointments: false });
      expect((await service.getPlanSeatUsage(A.ownerId, shopId)).used).toBe(2);
    });

    it('recepção que liga "atende" aparece pra agendar; mudar o cargo volta a seguir o cargo', async () => {
      // Aqui a unidade está com 2 de 3 vagas (fim do teste anterior)
      const reception = await prisma.barber.create({
        data: { barbershopId: shopId, name: 'Recepção', phone: phone(20), staffType: 'reception' },
      });
      const onPublicPage = async () =>
        (await service.getPublicBarbershopByslug(`int-seats-${RUN}`))!.barbers.some(
          (b) => b.id === reception.id,
        );
      expect(reception.takesAppointments).toBeNull();
      expect(await onPublicPage()).toBe(false);

      const on = await service.updateBarber(A.ownerId, shopId, reception.id, {
        takesAppointments: true,
      });
      expect(on.staffType).toBe('reception');
      expect(await onPublicPage()).toBe(true);

      // Trocar o cargo sem dizer se atende: volta a seguir o cargo (recepção não)
      const back = await service.updateBarber(A.ownerId, shopId, reception.id, {
        staffType: 'reception',
      });
      expect(back.takesAppointments).toBeNull();
      expect(await onPublicPage()).toBe(false);
    });

    it('estender o vínculo encerrado confere a vaga de novo', async () => {
      // 2 de 3 vagas: o freelancer com vínculo vencido não conta
      const DAY = 24 * 3_600_000;
      const expired = await prisma.barber.create({
        data: {
          barbershopId: shopId,
          name: 'Freela',
          phone: phone(30),
          accessStartsAt: new Date(Date.now() - 10 * DAY),
          accessEndsAt: new Date(Date.now() - DAY),
        },
      });
      expect((await service.getPlanSeatUsage(A.ownerId, shopId)).used).toBe(2);
      await service.createBarber(A.ownerId, shopId, { name: 'Vaga 31', phone: phone(31) });
      await expect(
        service.updateBarber(A.ownerId, shopId, expired.id, {
          accessEndsAt: new Date(Date.now() + 10 * DAY),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Mudar a data sem voltar a valer não esbarra
      await expect(
        service.updateBarber(A.ownerId, shopId, expired.id, {
          accessEndsAt: new Date(Date.now() - 2 * DAY),
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe('agenda da franquia no período', () => {
    // Mês bem no futuro, só com os agendamentos deste teste
    const year = new Date().getUTCFullYear() + 3;
    const from = new Date(Date.UTC(year, 5, 1, 3)); // 1º/jun, 00:00 em São Paulo
    const to = new Date(Date.UTC(year, 6, 1, 3));
    const seed = async (count: number) => {
      // Horários de 5 min seguidos, alternando os dois barbeiros: sem conflito
      const data = Array.from({ length: count }, (_, i) => {
        const startAt = new Date(from.getTime() + Math.floor(i / 2) * 5 * 60_000);
        return {
          barbershopId: A.shopId,
          customerId: A.customerId,
          barberId: i % 2 ? A.otherBarberId : A.barberId,
          startAt,
          endAt: new Date(startAt.getTime() + 5 * 60_000),
          status: 'CONFIRMED',
          source: 'PHONE',
        };
      });
      await prisma.appointment.createMany({ data });
    };
    const clear = () =>
      prisma.appointment.deleteMany({
        where: { barbershopId: A.shopId, startAt: { gte: from, lt: to } },
      });
    afterEach(clear);

    it('mais de 200 agendamentos no mês vêm todos (antes parava em 200)', async () => {
      await seed(250);
      const agenda = await service.getNetworkAgenda(A.ownerId, { startFrom: from, startTo: to });
      expect(agenda.appointments).toHaveLength(250);
      expect(agenda.truncated).toBe(false);
      // O último dia pedido também vem (a ordem é crescente)
      const last = agenda.appointments[agenda.appointments.length - 1];
      expect(last.startAt.getTime()).toBeGreaterThan(from.getTime());
      // A lista antiga, com período, segue o mesmo teto
      expect(
        await service.getNetworkAppointments(A.ownerId, { startFrom: from, startTo: to }),
      ).toHaveLength(250);
    });

    it('acima do teto avisa que cortou; período longo demais é recusado', async () => {
      await seed(NETWORK_AGENDA_CAP + 5);
      const agenda = await service.getNetworkAgenda(A.ownerId, { startFrom: from, startTo: to });
      expect(agenda.appointments).toHaveLength(NETWORK_AGENDA_CAP);
      expect(agenda.truncated).toBe(true);

      const tooLong = new Date(from.getTime() + 60 * 86_400_000);
      await expect(
        service.getNetworkAgenda(A.ownerId, { startFrom: from, startTo: tooLong }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.getNetworkAgenda(A.ownerId, { startFrom: to, startTo: from }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

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
      // Rede: o barbeiro não vê o faturamento das unidades, só a própria agenda
      const mine = await service.getNetworkDashboardStats(barber);
      expect(mine.totalBarbershops).toBe(0);
      expect(mine.view).toBe('mine');
      expect(mine.showRevenueToday).toBe(true);
      expect(mine.showQueue).toBe(true);
      expect(mine.canSell).toBe(true);
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
          subtotal: 0,
          total: 0,
        }),
      );
      await denied(service.getWalkIns(basic, A.shopId));
      const basicHome = await service.getNetworkDashboardStats(basic);
      expect(basicHome.view).toBe('mine');
      expect(basicHome.showQueue).toBe(false);
      expect(basicHome.showRevenueToday).toBe(false);
      expect(basicHome.canSell).toBe(false);
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
        subtotal: 0,
        total: 0,
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
      const desk = await service.getNetworkDashboardStats(reception);
      expect(desk.totalBarbershops).toBe(0);
      expect(desk.view).toBe('desk');
      expect(desk.showQueue).toBe(true);
      // Recepção vende no caixa, mas não vê o resumo do faturamento
      expect(desk.showRevenueToday).toBe(false);
      expect(desk.revenueToday).toBe(0);
      expect(desk.canSell).toBe(true);
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
        subtotal: 0,
        total: 0,
      });
      const other = await service.createSale(A.ownerId, A.shopId, {
        barberId: A.otherBarberId,
        saleType: 'SERVICE',
        items: [],
        subtotal: 0,
        total: 0,
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

    it('barbeiro não lança venda em nome de colega nem cobra o atendimento de outro', async () => {
      const sale = (extra: Record<string, unknown>) =>
        service.createSale(A.staffUserId, A.shopId, {
          saleType: 'SERVICE',
          items: [],
          subtotal: 0,
          total: 0,
          ...extra,
        });
      // Sem dizer o profissional: a venda é dele
      const mine = await sale({});
      expect(mine.barberId).toBe(A.barberId);
      await denied(sale({ barberId: A.otherBarberId }));
      const othersAppt = await book(at(day, '16:00'), { barberId: A.otherBarberId });
      await expect(sale({ appointmentId: othersAppt!.id })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        (await prisma.appointment.findUniqueOrThrow({ where: { id: othersAppt!.id } })).status,
      ).not.toBe('COMPLETED');
    });

    it('gerente (como no Booksy) faz quase tudo do dono: caixa, relatórios, comissões; só apagar a unidade é do dono', async () => {
      expect(await service.getMyAccessLevel(managerUserId, A.shopId)).toBe('manager');
      await expect(
        service.updateService(managerUserId, A.shopId, A.serviceId, { price: 55 }),
      ).resolves.toBeTruthy();
      await expect(service.getCashSessions(managerUserId, A.shopId)).resolves.toBeTruthy();
      const managerHome = await service.getNetworkDashboardStats(managerUserId);
      expect(managerHome).toMatchObject({
        totalBarbershops: 1,
        view: 'network',
        showRevenueToday: true,
        canSell: true,
      });
      // Atividade recente: só o que já aconteceu; comparação com o mesmo período
      expect(
        (managerHome.recentEvents as { type: string; date: string }[]).every(
          (e) => e.type !== 'appointment' || new Date(e.date).getTime() <= Date.now(),
        ),
      ).toBe(true);
      expect(managerHome.revenueSamePeriodLastMonth).toEqual(expect.any(Number));
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
