/**
 * Itens 197 a 199, contra o Postgres de verdade: despesa (forma, categoria,
 * data no fuso da unidade e caixa só do dia), bônus da indicação desfeito com
 * a venda e sessão de pacote que não volta a pacote cancelado ou devolvido.
 */
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, PACKAGE_UNDO_CLOSED_MESSAGE } from './barbershop.service';
import { toZonedParts } from '../common/timezone.util';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const TZ = 'America/Sao_Paulo';

describe('Despesa, indicação e pacote (integração)', () => {
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

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `r197-dona-${RUN}@test.local`,
          isActive: true,
          password: 'x',
          fullName: 'Dona',
          idDocNumber: `r197${RUN}`.slice(-20),
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
          name: 'Rodada 197',
          slug: `r197-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `r197-shop-${RUN}@test.local`,
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
  });

  afterAll(async () => {
    await prisma.sale.deleteMany({ where: { barbershopId: shopId } });
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  // ---- 197: despesa ----

  const expense = (over: Record<string, unknown> = {}) =>
    shops.createExpense(ownerId, shopId, {
      category: 'SUPPLIES',
      description: 'Lâminas',
      amount: 30,
      paymentMethod: 'CASH',
      ...over,
    } as never);

  it('recusa forma de pagamento, categoria e descrição fora do esperado', async () => {
    await expect(expense({ paymentMethod: 'cash' })).rejects.toThrow('Forma de pagamento inválida');
    await expect(expense({ category: 'Material' })).rejects.toThrow(
      'Categoria da despesa inválida',
    );
    await expect(expense({ description: '   ' })).rejects.toThrow('Descreva a despesa');
    await expect(expense({ description: 'x'.repeat(301) })).rejects.toThrow('Descreva a despesa');
  });

  it('data vira o dia da unidade, recusa data inválida ou futura', async () => {
    await expect(expense({ expenseDate: '2026-02-31' })).rejects.toThrow(
      'Data da despesa inválida',
    );
    await expect(expense({ expenseDate: 'amanhã' })).rejects.toThrow('Data da despesa inválida');
    await expect(expense({ expenseDate: '2999-01-01' })).rejects.toThrow(
      'Data da despesa inválida',
    );
    const e = await expense({ expenseDate: '2026-03-01' });
    // Meio-dia de São Paulo: continua sendo 1º de março no fuso da unidade
    expect(toZonedParts(e.expenseDate, TZ).dateStr).toBe('2026-03-01');
  });

  it('só a despesa de hoje sai do caixa aberto', async () => {
    const session = await prisma.cashSession.create({
      data: { barbershopId: shopId, openedByUserId: ownerId, openingBalance: 0 },
    });
    try {
      const today = await expense();
      expect(today.cashSessionId).toBe(session.id);
      const past = await expense({ expenseDate: '2026-03-02' });
      expect(past.cashSessionId).toBeNull();
    } finally {
      await prisma.expense.updateMany({
        where: { cashSessionId: session.id },
        data: { cashSessionId: null },
      });
      await prisma.cashSession.delete({ where: { id: session.id } });
    }
  });

  // ---- 198: indicação ----

  const sale = (customerId: number, paymentStatus = 'PAID') =>
    shops.createSale(ownerId, shopId, {
      customerId,
      saleType: 'SERVICE',
      items: [{ itemType: 'SERVICE', serviceId, quantity: 1, unitPrice: 50, totalPrice: 50 }],
      subtotal: 50,
      total: 50,
      paymentStatus,
      paymentMethod: paymentStatus === 'PAID' ? 'CASH' : undefined,
    });

  const referralPair = async (tag: string) => {
    const referrer = await prisma.customer.create({
      data: { networkId, name: `Quem indicou ${tag}`, phone: `+55119${RUN}${tag}`.slice(0, 20) },
    });
    const referred = await prisma.customer.create({
      data: { networkId, name: `Indicado ${tag}`, phone: `+55118${RUN}${tag}`.slice(0, 20) },
    });
    const referral = await prisma.customerReferral.create({
      data: { networkId, referrerId: referrer.id, referredId: referred.id },
    });
    return { referrer, referred, referral };
  };

  const points = async (id: number) =>
    (await prisma.customer.findUniqueOrThrow({ where: { id } })).loyaltyPoints;

  it('apagar a venda que completou a indicação tira o bônus e reabre', async () => {
    const { referrer, referred, referral } = await referralPair('a');
    const first = await sale(referred.id);
    expect(await points(referrer.id)).toBe(50);
    expect(
      (await prisma.customerReferral.findUniqueOrThrow({ where: { id: referral.id } })).saleId,
    ).toBe(first!.id);

    await shops.deleteSale(ownerId, shopId, first!.id);
    expect(await points(referrer.id)).toBe(0);
    const reopened = await prisma.customerReferral.findUniqueOrThrow({
      where: { id: referral.id },
    });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.saleId).toBeNull();

    // A próxima venda paga completa de novo (uma vez só)
    await sale(referred.id);
    expect(await points(referrer.id)).toBe(50);
  });

  it('voltar a venda para pendente tira o bônus, sem deixar saldo negativo', async () => {
    const { referrer, referred } = await referralPair('b');
    const first = await sale(referred.id);
    expect(await points(referrer.id)).toBe(50);
    // Quem indicou já gastou parte dos pontos
    await prisma.customer.update({ where: { id: referrer.id }, data: { loyaltyPoints: 20 } });
    await shops.updateSale(ownerId, shopId, first!.id, { paymentStatus: 'PENDING' } as never);
    expect(await points(referrer.id)).toBe(0);
  });

  // ---- 199: sessão desfeita em pacote fechado ----

  const packageWithUse = async (status: string, refunded: boolean) => {
    const customer = await prisma.customer.create({
      data: { networkId, name: `Pacote ${status}`, phone: `+55117${RUN}${status}`.slice(0, 20) },
    });
    const offer = await prisma.servicePackage.create({
      data: { barbershopId: shopId, serviceId, name: '5 cortes', totalSessions: 5, price: 200 },
    });
    const pkg = await prisma.clientPackage.create({
      data: {
        barbershopId: shopId,
        customerId: customer.id,
        servicePackageId: offer.id,
        totalSessions: refunded ? 2 : 5,
        usedSessions: 2,
        status,
        remainderRefundedAt: refunded ? new Date() : null,
      },
    });
    const use = await prisma.clientPackageUse.create({
      data: { clientPackageId: pkg.id, usedByUserId: ownerId },
    });
    return { customer, pkg, use };
  };

  it('pacote com o restante devolvido ou cancelado não ganha a sessão de volta', async () => {
    for (const [status, refunded] of [
      ['COMPLETED', true],
      ['CANCELLED', false],
    ] as const) {
      const { pkg, use } = await packageWithUse(status, refunded);
      await expect(shops.undoClientPackageUse(ownerId, shopId, use.id)).rejects.toThrow(
        PACKAGE_UNDO_CLOSED_MESSAGE,
      );
      const after = await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } });
      expect(after.status).toBe(status);
      expect(after.usedSessions).toBe(2);
    }
  });

  it('pacote ativo ganha a sessão de volta', async () => {
    const { pkg, use } = await packageWithUse('ACTIVE', false);
    await shops.undoClientPackageUse(ownerId, shopId, use.id);
    const after = await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(after.usedSessions).toBe(1);
    expect(after.status).toBe('ACTIVE');
  });

  it('apagar a venda que usou a sessão de pacote devolvido não reabre o pacote', async () => {
    const { customer, pkg, use } = await packageWithUse('COMPLETED', true);
    const s = await sale(customer.id);
    await prisma.clientPackageUse.update({ where: { id: use.id }, data: { saleId: s!.id } });
    await shops.deleteSale(ownerId, shopId, s!.id);
    const after = await prisma.clientPackage.findUniqueOrThrow({ where: { id: pkg.id } });
    expect(after.status).toBe('COMPLETED');
    expect(after.usedSessions).toBe(2);
    expect(await prisma.sale.findUnique({ where: { id: s!.id } })).toBeNull();
  });
});
