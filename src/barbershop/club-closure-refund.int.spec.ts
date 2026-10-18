/**
 * Encerrar a unidade devolve o resto do ciclo pago do clube (resto do item
 * 128): o tempo que falta ou, no plano com sessões contadas, as sessões que
 * sobraram, o menor dos dois. Estorno recusado não impede o encerramento.
 */
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste';
const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86_400_000;

describe('Clube ao encerrar a unidade (integração)', () => {
  const prisma = new PrismaService();
  const stub = {} as never;
  const refunds: Array<{ intent: string; amount?: number; connected: boolean }> = [];
  const stripe = {
    cancelSubscription: async () => undefined,
    getInvoice: async (id: string) => ({ id, payment_intent: `pi_${id}` }),
    createRefund: async (
      intent: string,
      amount?: number,
      _reason?: string,
      _key?: string,
      connected = false,
    ) => {
      if (intent.includes('recusa')) throw new Error('cartão recusou');
      refunds.push({ intent, amount, connected });
      return {};
    },
  };
  const shops = new BarbershopService(
    prisma,
    stub,
    stub,
    { isConfigured: () => false } as never,
    stripe as never,
    { email: async () => undefined, whatsapp: async () => undefined } as never,
    { notify: () => undefined } as never,
  );
  let ownerId: number;
  let networkId: number;
  let shopId: number;
  const payments: Record<string, number> = {};

  beforeAll(async () => {
    const roleId = (
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }))
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          email: `club-close-${RUN}@test.local`,
          password: 'x',
          fullName: 'Dona do clube',
          idDocNumber: `${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'female',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          roleId,
        },
      })
    ).id;
    networkId = (
      await prisma.network.create({ data: { ownerUserId: ownerId, name: `Rede ${RUN}` } })
    ).id;
    shopId = (
      await prisma.barbershop.create({
        data: {
          name: 'Clube Encerra',
          slug: `club-close-${RUN}`,
          address: 'Rua A, 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `club-shop-${RUN}@test.local`,
          timezone: 'America/Sao_Paulo',
          networkId,
          ownerUserId: ownerId,
        },
      })
    ).id;
    const service = await prisma.barbershopService.create({
      data: { barbershopId: shopId, name: 'Corte', durationMinutes: 30, price: new Decimal(50) },
    });
    const plan = (sessionsPerCycle: number | null) =>
      prisma.clientSubscriptionPlan.create({
        data: {
          barbershopId: shopId,
          serviceId: service.id,
          name: `Clube ${sessionsPerCycle ?? 'livre'}`,
          price: new Decimal(100),
          sessionsPerCycle,
        },
      });
    const unlimited = await plan(null);
    const four = await plan(4);
    const now = Date.now();
    const subscribe = async (
      label: string,
      planId: number,
      paid: number,
      startedDaysAgo: number,
      extra: { usedThisCycle?: number; connectAccountId?: string } = {},
    ) => {
      const client = await prisma.clientAccount.create({
        data: { email: `club-${label}-${RUN}@test.local`, name: `Cliente ${label}` },
      });
      const periodStart = new Date(now - startedDaysAgo * DAY);
      const periodEnd = new Date(periodStart.getTime() + 30 * DAY);
      const offer = await prisma.clientSubscriptionPlan.findUniqueOrThrow({
        where: { id: planId },
      });
      const sub = await prisma.clientSubscription.create({
        data: {
          barbershopId: shopId,
          clientAccountId: client.id,
          planId,
          stripeSubscriptionId: `sub_${label}_${RUN}`,
          status: 'ACTIVE',
          sessionsPerCycle: offer.sessionsPerCycle,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          ...extra,
        },
      });
      payments[label] = (
        await prisma.clientSubscriptionPayment.create({
          data: {
            subscriptionId: sub.id,
            stripeInvoiceId: `in_${label}_${RUN}`,
            amount: new Decimal(paid),
            platformFeePercent: new Decimal(10),
            status: 'SUCCEEDED',
            periodStart,
            periodEnd,
          },
        })
      ).id;
      return sub.id;
    };
    // Livre, 10 de 30 dias passados, pago 90 pela conta da unidade: volta 60
    await subscribe('tempo', unlimited.id, 90, 10, { connectAccountId: 'acct_teste' });
    // 4 sessões, 3 usadas, 3 dias passados, pago 100: volta 25 (as sessões)
    const sessionsSub = await subscribe('sessoes', four.id, 100, 3, { usedThisCycle: 3 });
    // Ciclo anterior do mesmo cliente, já estornado em 40 no painel do Stripe
    payments.anterior = (
      await prisma.clientSubscriptionPayment.create({
        data: {
          subscriptionId: sessionsSub,
          stripeInvoiceId: `in_anterior_${RUN}`,
          amount: new Decimal(100),
          refundedAmount: new Decimal(40),
          platformFeePercent: new Decimal(10),
          status: 'SUCCEEDED',
          periodStart: new Date(now - 33 * DAY),
          periodEnd: new Date(now - 3 * DAY),
        },
      })
    ).id;
    // O Stripe recusa este estorno: 15 de 30 dias, pago 30
    await subscribe('recusa', unlimited.id, 30, 15);
  });

  afterAll(async () => {
    await prisma.barbershop.deleteMany({ where: { id: shopId } });
    await prisma.network.deleteMany({ where: { id: networkId } });
    await prisma.$executeRaw`DELETE FROM "ClientAccount" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$executeRaw`DELETE FROM "User" WHERE email LIKE ${`%-${RUN}@test.local`}`;
    await prisma.$disconnect();
  });

  it('o repasse tira o que já voltou pro cliente', async () => {
    const report = await shops.getSubscriptionRevenueReport(ownerId, shopId);
    // 90 + 100 + 30 + (100 - 40)
    expect(report.grossAmount).toBe(280);
    expect(report.platformFeeAmount).toBe(28);
  });

  it('a prévia mostra e o encerramento devolve o resto do ciclo', async () => {
    const preview = await shops.getBarbershopDeletionPreview(ownerId, shopId);
    expect(preview.clubRefunds).toEqual([{ currency: 'BRL', amount: 100 }]);

    await shops.deleteBarbershop(ownerId, shopId);

    expect(refunds).toEqual(
      expect.arrayContaining([
        { intent: `pi_in_tempo_${RUN}`, amount: 6000, connected: true },
        { intent: `pi_in_sessoes_${RUN}`, amount: 2500, connected: false },
      ]),
    );
    expect(refunds).toHaveLength(2);
    const refunded = async (label: string) =>
      (
        await prisma.clientSubscriptionPayment.findUniqueOrThrow({ where: { id: payments[label] } })
      ).refundedAmount?.toNumber() ?? null;
    expect(await refunded('tempo')).toBe(60);
    expect(await refunded('sessoes')).toBe(25);
    expect(await refunded('anterior')).toBe(40);
    // Recusado: nada marcado como devolvido, e a unidade encerrou mesmo assim
    expect(await refunded('recusa')).toBeNull();
    expect(
      (await prisma.barbershop.findUniqueOrThrow({ where: { id: shopId } })).closedAt,
    ).not.toBeNull();
    expect(
      await prisma.clientSubscription.count({
        where: { barbershopId: shopId, status: { not: 'CANCELED' } },
      }),
    ).toBe(0);
  });
});
