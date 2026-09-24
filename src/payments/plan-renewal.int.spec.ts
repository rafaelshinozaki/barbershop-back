/**
 * Cobrança dos planos contra o Postgres de verdade (Stripe simulado).
 *
 * Antes: (1) a diferença de troca de plano ficava "pendente" pra sempre e o
 * job diário cobrava de novo todo dia; (2) o plano pago pelo checkout nunca
 * renovava nem vencia; (3) o webhook duplicava pagamento em evento repetido.
 */
import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from './coupons.service';
import { PaymentsService, RENEWAL_GRACE_DAYS } from './payments.service';
import { StripeController } from '../stripe/stripe.controller';

const RUN = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const DAY = 86400_000;

describe('Cobrança dos planos (integração com o banco)', () => {
  const prisma = new PrismaService();

  // ---- Stripe simulado ----
  const charges: { amount: number; key: string }[] = [];
  const intents = new Map<string, any>();
  let chargeBehavior: 'ok' | 'declined' | 'network' = 'ok';
  let defaultPm: string | null = 'pm_card';
  let seq = 0;
  const stripe = {
    getCustomer: async () => ({ id: 'cus_x' }),
    createCustomer: async () => ({ id: 'cus_x' }),
    createPaymentIntent: async (amount: number, _c: string, _cus: string, opts?: any) => {
      const id = `pi_co_${RUN}_${++seq}`;
      intents.set(id, {
        id,
        amount,
        status: 'succeeded',
        metadata: {},
        payment_method: 'pm_new',
        opts,
      });
      return { id, client_secret: `${id}_secret` };
    },
    updatePaymentIntent: async (id: string, data: any) => {
      intents.get(id).metadata = data.metadata;
    },
    retrievePaymentIntent: async (id: string) => intents.get(id),
    setDefaultPaymentMethod: async (_cus: string, pm: string) => {
      defaultPm = pm;
    },
    getDefaultPaymentMethodId: async () => defaultPm,
    findPaymentIntentByRenewalKey: async (key: string) =>
      [...intents.values()].find((pi) => pi.metadata?.renewalKey === key) ?? null,
    chargeOffSession: async (p: any) => {
      // Mesma idempotencyKey = mesma cobrança (como o Stripe)
      const existing = [...intents.values()].find((pi) => pi.idempotencyKey === p.idempotencyKey);
      if (existing) return existing;
      if (chargeBehavior === 'network') throw new Error('ECONNRESET');
      const id = `pi_rn_${RUN}_${++seq}`;
      const pi = {
        id,
        amount: p.amount,
        metadata: p.metadata,
        idempotencyKey: p.idempotencyKey,
        status: chargeBehavior === 'declined' ? 'requires_payment_method' : 'succeeded',
      };
      intents.set(id, pi);
      if (chargeBehavior === 'declined') {
        throw Object.assign(new Error('Your card was declined.'), {
          type: 'StripeCardError',
          raw: { payment_intent: pi },
        });
      }
      charges.push({ amount: p.amount, key: p.idempotencyKey });
      return pi;
    },
    getSubscription: async () => ({ current_period_start: 1, current_period_end: 2 }),
    handleWebhookEvent: async (payload: string) => JSON.parse(payload),
  };
  const emails: string[] = [];
  const email = {
    sendTemplateEmail: async (_u: number, template: string) => void emails.push(template),
  };
  const coupons = new CouponsService(prisma);
  const payments = new PaymentsService(prisma, stripe as never, email as never, coupons);

  let userId: number;
  let basicId: number;
  let premiumId: number;
  let freeId: number;

  const activeSub = () =>
    prisma.subscription.findFirstOrThrow({
      where: { userId, status: 'ACTIVE' },
      include: { plan: true },
    });
  /** Faz o plano vencer há `days` dias. */
  const expireBy = async (days: number) => {
    const sub = await activeSub();
    return prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - days * DAY) },
    });
  };

  beforeAll(async () => {
    const role =
      (await prisma.role.findFirst({ where: { name: 'BarbershopOwner' } })) ??
      (await prisma.role.create({ data: { name: 'BarbershopOwner' } }));
    userId = (
      await prisma.user.create({
        data: {
          email: `ren-${RUN}@test.local`,
          password: 'x',
          fullName: 'Renovação',
          idDocNumber: `ren${RUN}`.slice(-20),
          phone: `+5511${RUN}`.slice(0, 20),
          gender: 'male',
          birthdate: new Date('1990-01-01'),
          readTerms: true,
          isActive: true,
          stripeCustomerId: 'cus_x',
          roleId: role.id,
        },
      })
    ).id;
    const mk = async (name: string, price: number) =>
      (
        await prisma.plan.create({
          data: {
            name: `${name} ${RUN}`,
            price: new Prisma.Decimal(price),
            billingCycle: 'MONTHLY',
          },
        })
      ).id;
    basicId = await mk('Basic', 100);
    premiumId = await mk('Premium', 200);
    freeId = (await prisma.plan.findFirst({ where: { price: 0 } }))?.id ?? (await mk('Free', 0));
  });

  afterAll(async () => {
    const subs = await prisma.subscription.findMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { subscriptionId: { in: subs.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { userId } });
    await prisma.$executeRaw`DELETE FROM "Plan" WHERE id IN (${basicId}, ${premiumId}) `;
    await prisma.$executeRaw`DELETE FROM "User" WHERE id = ${userId}`;
    await prisma.$disconnect();
  });

  it('checkout guarda o cartão e marca o vencimento; tela + webhook juntos criam uma assinatura só', async () => {
    const { paymentIntentId } = await payments.createPaymentIntentForCheckout(userId, basicId);
    expect(intents.get(paymentIntentId!).opts).toEqual({ setupFutureUsage: 'off_session' });

    // A tela e o webhook confirmam ao mesmo tempo
    await Promise.all([
      payments.confirmPaymentIntent(paymentIntentId!),
      payments.confirmPaymentIntent(paymentIntentId!),
    ]);
    expect(await prisma.subscription.count({ where: { userId, status: 'ACTIVE' } })).toBe(1);
    expect(await prisma.payment.count({ where: { transactionId: paymentIntentId } })).toBe(1);

    const sub = await activeSub();
    const days = (sub.currentPeriodEnd!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(defaultPm).toBe('pm_new'); // o cartão usado virou o padrão
  });

  it('nada é cobrado antes do vencimento', async () => {
    await payments.processRecurringPayments();
    expect(charges).toHaveLength(0);
  });

  it('troca de plano não cria pendência; a renovação cobra o plano novo UMA vez, mesmo com várias execuções juntas', async () => {
    await prisma.plan.update({ where: { id: premiumId }, data: { stripePriceId: 'price_x' } });
    await payments.changePlan(userId, premiumId);
    const sub = await activeSub();
    expect(sub.planId).toBe(premiumId);
    expect(
      await prisma.payment.count({ where: { subscriptionId: sub.id, status: 'PENDING' } }),
    ).toBe(0);

    const before = await expireBy(0.01);
    // Agendamento + botão "processar" do backoffice (várias vezes) ao mesmo tempo
    await Promise.all(Array.from({ length: 5 }, () => payments.processRecurringPayments()));
    expect(charges).toEqual([expect.objectContaining({ amount: 20000 })]);

    const after = await activeSub();
    expect(after.currentPeriodEnd!.getTime()).toBe(before.currentPeriodEnd!.getTime() + 30 * DAY);
    const paid = await prisma.payment.findMany({
      where: { subscriptionId: sub.id, renewalKey: { not: null } },
    });
    expect(paid).toHaveLength(1);
    expect(paid[0].status).toBe('COMPLETED');

    // No dia seguinte, nada (antes cobrava de novo todo dia)
    await payments.processRecurringPayments();
    await payments.processRecurringPayments();
    expect(charges).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
      'PAID',
    );
  });

  it('webhook da renovação chegando depois não conta de novo', async () => {
    const paid = await prisma.payment.findFirstOrThrow({
      where: { renewalKey: { not: null }, status: 'COMPLETED', subscription: { userId } },
    });
    const periodBefore = (await activeSub()).currentPeriodEnd;
    await payments.finalizeRenewalPayment(paid.id);
    expect((await activeSub()).currentPeriodEnd).toEqual(periodBefore);
  });

  it('queda de rede no meio da cobrança: não cobra de novo às cegas', async () => {
    const sub = await expireBy(0.01);
    const before = charges.length;
    chargeBehavior = 'network';
    await payments.processRecurringPayments();
    const pending = await prisma.payment.findFirstOrThrow({
      where: { subscriptionId: sub.id, status: 'PENDING' },
    });
    expect(pending.transactionId).toBeNull();

    // Logo depois: não dá pra saber se a cobrança foi criada — nada de tentar
    chargeBehavior = 'ok';
    await payments.processRecurringPayments();
    expect(charges.length).toBe(before);

    // Uma hora depois: procura no Stripe pela chave; não existe → a tentativa
    // interrompida vira falha e uma nova (outra chave) cobra UMA vez
    await prisma.payment.update({
      where: { id: pending.id },
      data: { createdAt: new Date(Date.now() - 2 * 3600_000) },
    });
    await payments.processRecurringPayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'FAILED',
    );
    expect(charges.length).toBe(before + 1);
    expect(charges.at(-1)!.key).toMatch(/:2$/);
  });

  it('queda de rede depois que o Stripe cobrou: acha a cobrança pela chave e não cobra de novo', async () => {
    const sub = await expireBy(0.01);
    const before = charges.length;
    // O Stripe cobrou, mas a resposta se perdeu
    const original = stripe.chargeOffSession;
    stripe.chargeOffSession = async (p: any) => {
      await original(p);
      throw new Error('ETIMEDOUT');
    };
    await payments.processRecurringPayments();
    stripe.chargeOffSession = original;
    expect(charges.length).toBe(before + 1);

    const pending = await prisma.payment.findFirstOrThrow({
      where: { subscriptionId: sub.id, status: 'PENDING' },
    });
    await prisma.payment.update({
      where: { id: pending.id },
      data: { createdAt: new Date(Date.now() - 2 * 3600_000) },
    });
    await payments.processRecurringPayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe(
      'COMPLETED',
    );
    expect(charges.length).toBe(before + 1);
    expect((await activeSub()).currentPeriodEnd!.getTime()).toBe(
      sub.currentPeriodEnd!.getTime() + 30 * DAY,
    );
  });

  it('cartão recusado: plano segue na tolerância, avisa uma vez, tenta 1x por dia e depois cai pro gratuito', async () => {
    // Recomeça o período da assinatura atual como vencido
    const sub = await activeSub();
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - DAY), renewalFailedAt: null },
    });
    emails.length = 0;
    const chargesBefore = charges.length;
    chargeBehavior = 'declined';
    await payments.processRecurringPayments();
    let now = await activeSub();
    expect(now.id).toBe(sub.id); // continua ativo na tolerância
    expect(now.renewalFailedAt).toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
      'PAST_DUE',
    );
    expect(emails).toEqual(['recurring_payment_failed']);

    // Mesmo dia: não tenta de novo
    const attemptsBefore = await prisma.payment.count({ where: { subscriptionId: sub.id } });
    await payments.processRecurringPayments();
    expect(await prisma.payment.count({ where: { subscriptionId: sub.id } })).toBe(attemptsBefore);

    // Tolerância esgotada: cai pro gratuito, sem nova cobrança
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - (RENEWAL_GRACE_DAYS + 1) * DAY) },
    });
    await prisma.payment.updateMany({
      where: { subscriptionId: sub.id },
      data: { createdAt: new Date(Date.now() - 2 * DAY) },
    });
    await payments.processRecurringPayments();
    now = await activeSub();
    expect(now.planId).toBe(freeId);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe(
      'INACTIVE',
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).membership).toBe(
      'FREE',
    );
    expect(emails).toEqual(['recurring_payment_failed']); // avisou uma vez só
    expect(charges.length).toBe(chargesBefore);
    chargeBehavior = 'ok';
  });

  it('admin "forçar cobrança" de um pagamento já pago não cobra de novo', async () => {
    const paid = await prisma.payment.findFirstOrThrow({
      where: { status: 'COMPLETED', subscription: { userId } },
    });
    const before = charges.length;
    const result = await payments.forceRecurringPayment(paid.id);
    expect(result.success).toBe(false);
    expect(charges.length).toBe(before);
  });

  describe('webhook', () => {
    const controller = new StripeController(
      { get: () => 'whsec' } as never,
      prisma,
      email as never,
      stripe as never,
      payments,
    );
    const deliver = (event: unknown) =>
      controller.handleWebhook('sig', { rawBody: Buffer.from(JSON.stringify(event)) } as never);

    it('fatura repetida do plano (assinatura no Stripe) registra um pagamento só', async () => {
      const sub = await prisma.subscription.create({
        data: {
          userId,
          planId: basicId,
          startSubDate: new Date(),
          status: 'INACTIVE',
          stripeSubscriptionId: `sub_${RUN}`,
        },
      });
      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: `in_${RUN}`,
            subscription: `sub_${RUN}`,
            payment_intent: `pi_inv_${RUN}`,
            amount_paid: 10000,
            created: Math.floor(Date.now() / 1000),
            currency: 'brl',
          },
        },
      };
      emails.length = 0;
      await deliver(event);
      await deliver(event);
      expect(await prisma.payment.count({ where: { subscriptionId: sub.id } })).toBe(1);
      expect(emails).toEqual(['invoice_email']);
    });

    it('fatura repetida da assinatura do cliente não zera de novo as sessões usadas', async () => {
      const network = await prisma.network.create({
        data: { ownerUserId: userId, name: `Rede ${RUN}` },
      });
      const shop = await prisma.barbershop.create({
        data: {
          name: `Unidade ${RUN}`,
          slug: `ren-${RUN}`,
          address: 'Rua 1',
          city: 'SP',
          state: 'SP',
          country: 'BR',
          postalCode: '01000000',
          phone: '11999999999',
          email: `u-${RUN}@test.local`,
          networkId: network.id,
          ownerUserId: userId,
        },
      });
      const service = await prisma.barbershopService.create({
        data: { barbershopId: shop.id, name: 'Corte', durationMinutes: 30, price: 50 },
      });
      const plan = await prisma.clientSubscriptionPlan.create({
        data: { barbershopId: shop.id, serviceId: service.id, name: 'Mensal', price: 80 },
      });
      const client = await prisma.clientAccount.create({
        data: { email: `cli-ren-${RUN}@test.local`, name: 'Cliente' },
      });
      const clientSub = await prisma.clientSubscription.create({
        data: {
          barbershopId: shop.id,
          clientAccountId: client.id,
          planId: plan.id,
          stripeSubscriptionId: `sub_cli_${RUN}`,
          status: 'ACTIVE',
        },
      });
      const event = {
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: `in_cli_${RUN}`,
            subscription: `sub_cli_${RUN}`,
            amount_paid: 8000,
            created: Math.floor(Date.now() / 1000),
          },
        },
      };
      await deliver(event);
      // O cliente usa 3 sessões no ciclo; o Stripe reenvia a mesma fatura
      await prisma.clientSubscription.update({
        where: { id: clientSub.id },
        data: { usedThisCycle: 3 },
      });
      await deliver(event);
      expect(
        (await prisma.clientSubscription.findUniqueOrThrow({ where: { id: clientSub.id } }))
          .usedThisCycle,
      ).toBe(3);
      expect(
        await prisma.clientSubscriptionPayment.count({ where: { subscriptionId: clientSub.id } }),
      ).toBe(1);

      await prisma.clientAccount.delete({ where: { id: client.id } });
      await prisma.network.delete({ where: { id: network.id } });
    });

    it('checkout concluído pelo webhook (a pessoa fechou a aba antes da tela confirmar)', async () => {
      const { paymentIntentId } = await payments.createPaymentIntentForCheckout(userId, basicId);
      await deliver({
        type: 'payment_intent.succeeded',
        data: { object: intents.get(paymentIntentId!) },
      });
      expect(await prisma.payment.count({ where: { transactionId: paymentIntentId } })).toBe(1);
    });

    it('erro ao processar responde erro (o Stripe reenvia) em vez de "ok"', async () => {
      const original = payments.finalizeRenewalPayment.bind(payments);
      payments.finalizeRenewalPayment = async () => {
        throw new Error('banco fora do ar');
      };
      const paid = await prisma.payment.findFirstOrThrow({
        where: { renewalKey: { not: null }, subscription: { userId } },
      });
      await expect(
        deliver({
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_z', metadata: { renewalKey: paid.renewalKey } } },
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      payments.finalizeRenewalPayment = original;
    });
  });
});
