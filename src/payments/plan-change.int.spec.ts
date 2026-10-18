/**
 * Trocar e cancelar o plano (Postgres de verdade, Stripe simulado).
 *
 * Antes: subir de plano liberava o limite na hora e só cobrava na renovação
 * (dava pra usar o maior o mês todo e voltar na véspera); cancelar cortava
 * na hora o mês já pago.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from './coupons.service';
import { PaymentsService } from './payments.service';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86400_000;

describe('Trocar e cancelar o plano (integração com o banco)', () => {
  const prisma = new PrismaService();
  const charges: { amount: number; key: string }[] = [];
  let declined = false;
  let seq = 0;
  const stripe = {
    getDefaultPaymentMethodId: async () => 'pm_card',
    chargeOffSession: async (p: any) => {
      if (declined) {
        throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' });
      }
      charges.push({ amount: p.amount, key: p.idempotencyKey });
      return { id: `pi_chg_${RUN}_${++seq}`, status: 'succeeded' };
    },
    // Assinatura antiga na Stripe (plano trocado pelo backoffice)
    getSubscription: async () => ({
      items: { data: [{ id: 'si_1', price: { id: 'price_basic' } }] },
    }),
    updateSubscription: jest.fn(async () => ({})),
    createRefund: jest.fn(async () => ({ id: 're_1', status: 'succeeded' })),
    cancelSubscription: jest.fn(async () => ({})),
  };
  const email = { sendTemplateEmail: async () => undefined };
  // Uso de hoje: cabe, a não ser que o teste diga que não
  let usageFits = true;
  const barbershops = {
    assertUsageFitsPlan: async () => {
      if (!usageFits) throw new BadRequestException('Não cabe no plano');
    },
  };
  const payments = new PaymentsService(
    prisma,
    stripe as never,
    email as never,
    new CouponsService(prisma),
    barbershops as never,
  );

  let userId: number;
  let basicId: number;
  let premiumId: number;
  let yearlyId: number;
  let freeId: number;

  const activeSub = () =>
    prisma.subscription.findFirstOrThrow({ where: { userId, status: 'ACTIVE' } });

  /** Assinatura paga do Basic com `daysLeft` dias até vencer */
  const startBasic = async (daysLeft: number) => {
    await prisma.subscription.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
    return prisma.subscription.create({
      data: {
        userId,
        planId: basicId,
        startSubDate: new Date(),
        status: 'ACTIVE',
        currentPeriodEnd: new Date(Date.now() + daysLeft * DAY),
      },
    });
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `chg-${RUN}@test.local`,
          password: 'x',
          fullName: 'Troca de plano',
          idDocNumber: `chg${RUN}`.slice(-20),
          phone: `+5512${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          stripeCustomerId: 'cus_chg',
          membership: 'PAID',
          roleId: role.id,
        },
      })
    ).id;
    const mk = async (name: string, price: number, billingCycle = 'MONTHLY') =>
      (
        await prisma.plan.create({
          data: { name: `${name} ${RUN}`, price: new Prisma.Decimal(price), billingCycle },
        })
      ).id;
    basicId = await mk('Basic', 100);
    premiumId = await mk('Premium', 200);
    yearlyId = await mk('Anual', 1200, 'YEARLY');
    freeId = (await prisma.plan.findFirst({ where: { price: 0 } }))?.id ?? (await mk('Free', 0));
  });

  afterAll(async () => {
    const subs = await prisma.subscription.findMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "Plan" WHERE id IN (${basicId}, ${premiumId}, ${yearlyId})`;
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('subir cobra na hora a diferença proporcional; cartão recusado não libera o plano', async () => {
    const sub = await startBasic(15);
    charges.length = 0;
    declined = true;
    await expect(payments.changePlan(userId, premiumId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await activeSub()).planId).toBe(basicId);

    declined = false;
    await payments.changePlan(userId, premiumId);
    // Metade do período: metade da diferença (R$ 100 → R$ 50)
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBeGreaterThan(4_990);
    expect(charges[0].amount).toBeLessThanOrEqual(5_000);
    const after = await activeSub();
    expect(after.planId).toBe(premiumId);
    expect(after.currentPeriodEnd!.getTime()).toBe(sub.currentPeriodEnd!.getTime());
    expect(
      await prisma.payment.count({ where: { subscriptionId: sub.id, status: 'COMPLETED' } }),
    ).toBe(1);
  });

  it('mensal → anual: o anual menos o crédito do que falta, e o período recomeça', async () => {
    await startBasic(15);
    charges.length = 0;
    await payments.changePlan(userId, yearlyId);
    // R$ 1.200 − metade de R$ 100
    expect(charges[0].amount).toBeGreaterThanOrEqual(115_000);
    expect(charges[0].amount).toBeLessThan(115_010);
    const days = ((await activeSub()).currentPeriodEnd!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(364.9);
  });

  it('descer agenda a troca pra renovação (o plano atual vale até lá); uso acima do limite recusa', async () => {
    await startBasic(10);
    await prisma.subscription.update({
      where: { id: (await activeSub()).id },
      data: { planId: premiumId },
    });
    charges.length = 0;

    usageFits = false;
    await expect(payments.changePlan(userId, basicId)).rejects.toBeInstanceOf(BadRequestException);
    usageFits = true;

    await payments.changePlan(userId, basicId);
    let sub = await activeSub();
    expect(sub).toMatchObject({ planId: premiumId, pendingPlanId: basicId });
    expect(charges).toHaveLength(0);

    // Desistiu: escolher o plano atual desfaz o agendamento
    await payments.changePlan(userId, premiumId);
    expect((await activeSub()).pendingPlanId).toBeNull();
    await payments.changePlan(userId, basicId);

    // Venceu: o plano menor entra e a renovação cobra o preço dele
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    await payments.processRecurringPayments();
    sub = await activeSub();
    expect(sub).toMatchObject({ planId: basicId, pendingPlanId: null });
    expect(charges.map((c) => c.amount)).toEqual([10_000]);
  });

  it('voltar pro gratuito ou trocar com o plano vencido não passa por aqui', async () => {
    await startBasic(10);
    await expect(payments.changePlan(userId, freeId)).rejects.toThrow('cancele a assinatura');
    await prisma.subscription.update({
      where: { id: (await activeSub()).id },
      data: { currentPeriodEnd: new Date(Date.now() - DAY) },
    });
    await expect(payments.changePlan(userId, premiumId)).rejects.toThrow('Regularize');
  });

  it('cancelar vale até o vencimento; na renovação volta pro gratuito sem cobrar', async () => {
    const sub = await startBasic(10);
    charges.length = 0;
    await payments.unsubscribe(userId);
    let now = await activeSub();
    expect(now).toMatchObject({ id: sub.id, planId: basicId, cancelAtPeriodEnd: true });
    expect(now.cancelationDate!.getTime()).toBe(sub.currentPeriodEnd!.getTime());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
      'PAID',
    );
    // Cancelar de novo não muda nada
    await payments.unsubscribe(userId);

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    await payments.processRecurringPayments();
    now = await activeSub();
    expect(now.planId).toBe(freeId);
    expect(charges).toHaveLength(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
      'FREE',
    );
    // No gratuito não há o que cancelar
    await expect(payments.unsubscribe(userId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('plano trocado pelo backoffice: a assinatura antiga da Stripe passa pro preço novo, sem cobrar', async () => {
    await prisma.plan.update({
      where: { id: premiumId },
      data: { stripePriceId: 'price_premium' },
    });
    const sub = await startBasic(10);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { planId: premiumId, stripeSubscriptionId: `sub_chg_${RUN}` },
    });
    await payments.syncStripePlanPrice([userId]);
    expect(stripe.updateSubscription).toHaveBeenCalledWith(`sub_chg_${RUN}`, {
      items: [{ id: 'si_1', price: 'price_premium' }],
      proration_behavior: 'none',
    });
  });
  describe('estorno do plano (item 174)', () => {
    const pay = (subscriptionId: number, daysAgo: number, intent: string) =>
      prisma.payment.create({
        data: {
          subscriptionId,
          amount: new Prisma.Decimal(100),
          paymentDate: new Date(Date.now() - daysAgo * DAY),
          nextPaymentDate: new Date(Date.now() + 15 * DAY),
          paymentMethod: 'stripe',
          transactionId: intent,
          status: 'COMPLETED',
        },
      });

    it('estornar a cobrança do período atual encerra o plano e cancela na Stripe', async () => {
      const sub = await startBasic(15);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { stripeSubscriptionId: `sub_ref_${RUN}` },
      });
      await prisma.user.update({ where: { id: userId }, data: { membership: 'PAID' } });
      await pay(sub.id, 45, `pi_old_${RUN}`);
      const current = await pay(sub.id, 15, `pi_cur_${RUN}`);
      stripe.cancelSubscription.mockClear();

      await payments.staffRefundPlanPayment(current.id);

      expect(stripe.createRefund).toHaveBeenCalledWith(
        `pi_cur_${RUN}`,
        undefined,
        undefined,
        `plan-refund-${current.id}`,
      );
      expect(stripe.cancelSubscription).toHaveBeenCalledWith(`sub_ref_${RUN}`);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: current.id } })).status).toBe(
        'REFUNDED',
      );
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe(
        'INACTIVE',
      );
      expect((await activeSub()).planId).toBe(freeId);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
        'FREE',
      );
      // De novo (ou o webhook do mesmo estorno): nada muda
      await expect(payments.staffRefundPlanPayment(current.id)).rejects.toThrow(
        'Pagamento não encontrado',
      );
    });

    it('cobrança antiga só devolve; o plano continua', async () => {
      const sub = await startBasic(15);
      const old = await pay(sub.id, 45, `pi_old2_${RUN}`);
      await pay(sub.id, 15, `pi_cur2_${RUN}`);
      stripe.cancelSubscription.mockClear();

      await payments.staffRefundPlanPayment(old.id);

      expect((await prisma.payment.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
        'REFUNDED',
      );
      expect((await activeSub()).id).toBe(sub.id);
      expect(stripe.cancelSubscription).not.toHaveBeenCalled();
    });

    it('estorno total pelo painel da Stripe tem o mesmo efeito; parcial não muda nada', async () => {
      const sub = await startBasic(15);
      const current = await pay(sub.id, 15, `pi_dash_${RUN}`);
      await payments.syncPlanRefund({ payment_intent: `pi_dash_${RUN}`, refunded: false } as never);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: current.id } })).status).toBe(
        'COMPLETED',
      );
      await payments.syncPlanRefund({ payment_intent: `pi_dash_${RUN}`, refunded: true } as never);
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: current.id } })).status).toBe(
        'REFUNDED',
      );
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe(
        'INACTIVE',
      );
    });
  });
});
