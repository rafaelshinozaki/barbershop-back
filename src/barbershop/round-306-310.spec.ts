import { BadRequestException } from '@nestjs/common';
import { BarbershopService } from './barbershop.service';
import {
  CHECKOUT_HAS_PAID_PLAN,
  PaymentsService,
  blocksNewCheckout,
} from '../payments/payments.service';
import { StripeController } from '../stripe/stripe.controller';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };

describe('checkout com plano pago (306)', () => {
  it('recusa o checkout e manda para a troca de plano', async () => {
    const createPaymentIntent = jest.fn();
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    Object.assign(svc, {
      logger,
      stripeService: { createPaymentIntent },
      prisma: {
        plan: { findFirst: async () => ({ id: 2, price: 80, name: 'Pro' }) },
        user: {
          findUnique: async () => ({
            id: 3,
            isActive: true,
            email: 'ana@x.com',
            fullName: 'Ana',
            stripeCustomerId: null,
          }),
        },
        subscription: {
          findFirst: async () => ({
            stripeSubscriptionId: null,
            currentPeriodEnd: new Date('2026-12-01'),
            plan: { price: 40 },
          }),
        },
      },
    });
    await expect(svc.createPaymentIntentForCheckout(3, 2)).rejects.toThrow(CHECKOUT_HAS_PAID_PLAN);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('pagamento confirmado com plano pago ativo é estornado', async () => {
    const createRefund = jest.fn().mockResolvedValue({});
    const create = jest.fn();
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    const tx = {
      $executeRaw: async () => 0,
      payment: { findFirst: async () => null, create },
      subscription: {
        findFirst: async () => ({
          stripeSubscriptionId: 'sub_pago',
          currentPeriodEnd: new Date('2026-12-01'),
          plan: { price: 40 },
        }),
        findMany: async () => [],
        updateMany: async () => ({ count: 0 }),
        create,
      },
      user: { update: async () => ({}) },
      friendInvite: { findFirst: async () => null },
    };
    Object.assign(svc, {
      logger,
      stripeService: { createRefund },
      prisma: {
        plan: { findFirst: async () => ({ id: 2, price: 80, billingCycle: 'MONTHLY' }) },
        user: { findUnique: async () => ({ id: 3, stripeCustomerId: 'cus' }) },
        $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
      },
    });
    await expect(
      (
        svc as unknown as { createSubscriptionAfterPayment: (...args: any[]) => any }
      ).createSubscriptionAfterPayment(3, 2, 'pi_corrida'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createRefund).toHaveBeenCalledWith(
      'pi_corrida',
      undefined,
      'duplicate',
      'checkout-blocked:pi_corrida',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('checkout que substitui o gratuito cancela a assinatura na Stripe', async () => {
    const cancelSubscription = jest.fn().mockResolvedValue({});
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    const tx = {
      $executeRaw: async () => 0,
      payment: { findFirst: async () => null, create: async () => ({}) },
      subscription: {
        findFirst: async () => ({
          stripeSubscriptionId: 'sub_free',
          currentPeriodEnd: null,
          plan: { price: 0 },
        }),
        findMany: async () => [{ stripeSubscriptionId: 'sub_free' }],
        updateMany: async () => ({ count: 1 }),
        create: async () => ({ id: 9 }),
      },
      user: { update: async () => ({}) },
      friendInvite: { findFirst: async () => null },
    };
    Object.assign(svc, {
      logger,
      stripeService: { cancelSubscription },
      prisma: {
        plan: { findFirst: async () => ({ id: 2, price: 80, billingCycle: 'MONTHLY' }) },
        user: { findUnique: async () => ({ id: 3, stripeCustomerId: 'cus' }) },
        $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
      },
    });
    const out = await (
      svc as unknown as { createSubscriptionAfterPayment: (...args: any[]) => any }
    ).createSubscriptionAfterPayment(3, 2, 'pi_free');
    expect(out.success).toBe(true);
    expect(cancelSubscription).toHaveBeenCalledWith('sub_free');
  });

  it('fatura paga de assinatura inativa não a reativa', async () => {
    const update = jest.fn();
    const getSubscription = jest.fn();
    const controller = Object.create(StripeController.prototype) as StripeController;
    Object.assign(controller, {
      logger,
      stripeService: { getSubscription },
      prisma: {
        subscription: {
          findFirst: async () => ({
            id: 4,
            status: 'INACTIVE',
            userId: 1,
            stripeSubscriptionId: 'sub_x',
            pendingPlanId: null,
          }),
          update,
        },
        user: { update },
        $transaction: async () => null,
      },
    });
    await (
      controller as unknown as { handleInvoicePaymentSucceeded: (...args: any[]) => any }
    ).handleInvoicePaymentSucceeded({
      id: 'in_1',
      subscription: 'sub_x',
      payment_intent: 'pi_1',
      amount_paid: 1000,
      currency: 'brl',
      created: 1,
      billing_reason: 'subscription_cycle',
    });
    expect(getSubscription).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('aviso da assinatura na Stripe (307 e 308)', () => {
  const controllerFor = (status: string, club?: { status: string }) => {
    const userUpdate = jest.fn();
    const subUpdate = jest.fn();
    const releaseToFreePlan = jest.fn();
    const clubRow = club ?? { status: 'INCOMPLETE' };
    const controller = Object.create(StripeController.prototype) as StripeController;
    Object.assign(controller, {
      logger,
      paymentsService: { releaseToFreePlan },
      prisma: {
        subscription: {
          findFirst: async () => (club ? null : { id: 4, userId: 1, status: 'ACTIVE' }),
        },
        user: { update: userUpdate },
        subscriptionUpdate: subUpdate,
        clientSubscription: {
          updateMany: async ({ data }: { data: { status: string } }) => {
            Object.assign(clubRow, data);
            return { count: 1 };
          },
        },
      },
    });
    (
      controller as unknown as { prisma: { subscription: { update: jest.Mock } } }
    ).prisma.subscription.update = subUpdate;
    return { controller, userUpdate, subUpdate, releaseToFreePlan, clubRow };
  };

  it('past_due deixa a assinatura ativa; canceled volta ao gratuito', async () => {
    const past = controllerFor('past_due');
    await (
      past.controller as unknown as { handleSubscriptionUpdated: (...args: any[]) => any }
    ).handleSubscriptionUpdated({ id: 'sub_1', status: 'past_due', cancel_at_period_end: false });
    expect(past.subUpdate.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(past.userUpdate.mock.calls[0][0].data.membership).toBe('PAST_DUE');
    expect(past.releaseToFreePlan).not.toHaveBeenCalled();

    const canceled = controllerFor('canceled');
    await (
      canceled.controller as unknown as { handleSubscriptionUpdated: (...args: any[]) => any }
    ).handleSubscriptionUpdated({ id: 'sub_1', status: 'canceled', cancel_at_period_end: false });
    expect(canceled.releaseToFreePlan).toHaveBeenCalledWith(4, 1);
    expect(canceled.subUpdate).not.toHaveBeenCalled();
  });

  it('fatura recusada não encerra a assinatura', async () => {
    const userUpdate = jest.fn();
    const subUpdate = jest.fn();
    const controller = Object.create(StripeController.prototype) as StripeController;
    Object.assign(controller, {
      logger,
      prisma: {
        subscription: {
          findFirst: async () => ({ id: 4, userId: 1, status: 'ACTIVE' }),
          update: subUpdate,
        },
        user: { update: userUpdate },
      },
    });
    await (
      controller as unknown as { handleInvoicePaymentFailed: (...args: any[]) => any }
    ).handleInvoicePaymentFailed({ subscription: 'sub_1' });
    expect(userUpdate.mock.calls[0][0].data.membership).toBe('PAST_DUE');
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('encerrar pela Stripe deixa a conta no gratuito', async () => {
    const created: { planId: number; status: string }[] = [];
    const memberships: { membership: string }[] = [];
    const svc = Object.create(PaymentsService.prototype) as PaymentsService;
    Object.assign(svc, {
      logger,
      prisma: {
        subscription: {
          update: async () => ({}),
          create: async ({ data }: { data: { planId: number; status: string } }) => {
            created.push(data);
          },
        },
        plan: { findFirst: async () => ({ id: 1 }) },
        user: {
          update: async ({ data }: { data: { membership: string } }) => {
            memberships.push(data);
          },
        },
      },
    });
    await svc.releaseToFreePlan(4, 1);
    expect(created[0]).toMatchObject({ planId: 1, status: 'ACTIVE' });
    expect(memberships[0].membership).toBe('FREE');
  });

  it('clube incompleto que expira fica cancelado e pode assinar de novo', async () => {
    const club = { status: 'INCOMPLETE', cancelAtPeriodEnd: false };
    const { controller, clubRow } = controllerFor('incomplete_expired', club);
    await (
      controller as unknown as { handleSubscriptionUpdated: (...args: any[]) => any }
    ).handleSubscriptionUpdated({
      id: 'sub_c',
      status: 'incomplete_expired',
      cancel_at_period_end: false,
    });
    expect(clubRow.status).toBe('CANCELED');
    expect(['INCOMPLETE', 'ACTIVE', 'PAST_DUE'].includes(clubRow.status)).toBe(false);
  });
});

describe('fatura atrasada do clube (309)', () => {
  it('a fatura de outubro não zera as sessões de novembro', async () => {
    const sub = {
      id: 8,
      currentPeriodStart: null as Date | null,
      usedThisCycle: 0,
      connectAccountId: null,
      applicationFeePercent: null,
    };
    const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
    const controller = Object.create(StripeController.prototype) as StripeController;
    Object.assign(controller, {
      logger,
      stripeService: {
        getSubscription: async () => ({
          current_period_start: sec('2026-11-01T00:00:00Z'),
          current_period_end: sec('2026-12-01T00:00:00Z'),
        }),
      },
      prisma: {
        clientSubscription: { findFirst: async () => sub },
        $transaction: async (fn: (tx: object) => Promise<void>) =>
          fn({
            $executeRaw: async () => 0,
            clientSubscriptionPayment: {
              findUnique: async () => null,
              upsert: async () => ({}),
            },
            clientSubscription: {
              update: async ({ data }: { data: typeof sub }) => Object.assign(sub, data),
            },
          }),
      },
    });
    const invoice = (id: string, end: string) => ({
      id,
      amount_paid: 5000,
      currency: 'brl',
      period_end: sec(end),
      lines: { data: [{ period: { end: sec(end) } }] },
    });
    const run = (
      controller as unknown as { handleClientSubscriptionInvoiceSucceeded: (...args: any[]) => any }
    ).handleClientSubscriptionInvoiceSucceeded;
    await run.call(controller, invoice('in_nov', '2026-12-01T00:00:00Z'), 'sub_c');
    sub.usedThisCycle = 2;
    await run.call(controller, invoice('in_oct', '2026-11-01T00:00:00Z'), 'sub_c');
    expect(sub.usedThisCycle).toBe(2);
  });
});

describe('resumo financeiro (310)', () => {
  it('clube via Connect e repasse de aluguel entram na receita', async () => {
    const shop = Object.create(BarbershopService.prototype) as BarbershopService;
    Object.assign(shop, {
      ensureBarbershopAccess: async () => ({ timezone: 'America/Sao_Paulo', currency: 'BRL' }),
      ensureModuleAccess: async () => undefined,
      retainedPrepayments: async () => [],
      prisma: {
        sale: { findMany: async () => [] },
        expense: { findMany: async () => [] },
        chairRentPayment: { aggregate: async () => ({ _sum: { amount: 0 } }) },
        clientSubscriptionPayment: {
          findMany: async () => [
            {
              amount: 100,
              refundedAmount: 0,
              platformFeePercent: 10,
              createdAt: new Date('2026-10-10T15:00:00Z'),
              settledViaConnect: true,
            },
          ],
        },
        subscriptionPayout: { findMany: async () => [] },
        chairRentPayout: {
          findMany: async () => [{ amount: 40, paidAt: new Date('2026-10-12T15:00:00Z') }],
        },
        appointmentTip: { findMany: async () => [] },
      },
    });
    const summary = await shop.getFinancialSummary(
      1,
      2,
      new Date('2026-10-01'),
      new Date('2026-10-31'),
    );
    expect(summary.totalRevenue).toBe(130);
    expect(summary.netProfit).toBe(130);
    const byMethod = Object.fromEntries(
      summary.revenueByPaymentMethod.map((row) => [row.category, row.total]),
    );
    expect(byMethod.CLUB).toBe(90);
    expect(byMethod.CHAIR_RENT).toBe(40);
  });
});

describe('plano gratuito não trava o checkout', () => {
  it('preço zero não bloqueia, mesmo com id na Stripe', () => {
    expect(
      blocksNewCheckout({
        stripeSubscriptionId: 'sub_free',
        currentPeriodEnd: null,
        plan: { price: 0 },
      }),
    ).toBe(false);
  });
});
