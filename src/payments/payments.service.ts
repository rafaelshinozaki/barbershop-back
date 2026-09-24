// src\payments\payments.service.ts
import { PAGAMENTO_STATUS, PLANO_STATUS, MEMBERSHIP_STATUS } from '@/common';
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { addDays, addYears, format } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from './coupons.service';
import Stripe from 'stripe';

/** Cupom aplicado no checkout do plano (valores em reais). */
interface CheckoutCoupon {
  couponId: number;
  originalAmount: number;
  discountAmount: number;
}

/** Menor cobrança que o Stripe aceita em BRL. */
const MIN_STRIPE_CHARGE = 0.5;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * "Pagamento vencido" = plano ativo cobrado por nós que passou do vencimento.
 * Antes contava todo pagamento antigo com data passada (depois da primeira
 * renovação, o pagamento anterior aparecia como vencido pra sempre).
 */
export const OVERDUE_SUBSCRIPTION_FILTER = () => ({
  status: PLANO_STATUS.ACTIVE,
  stripeSubscriptionId: null,
  currentPeriodEnd: { lte: new Date() },
});

/** Fica só o pagamento mais recente de cada assinatura. */
export function latestPerSubscription<T extends { subscriptionId: number; nextPaymentDate: Date }>(
  payments: T[],
): T[] {
  const latest = new Map<number, T>();
  for (const p of payments) {
    const cur = latest.get(p.subscriptionId);
    if (!cur || p.nextPaymentDate > cur.nextPaymentDate) latest.set(p.subscriptionId, p);
  }
  return [...latest.values()];
}

/** Dias depois do vencimento em que o plano segue ativo tentando cobrar. */
export const RENEWAL_GRACE_DAYS = 7;

/** Próximo vencimento (mesma regra da contratação: 30 dias ou 1 ano). */
function addCycle(from: Date, billingCycle: string) {
  return billingCycle === 'YEARLY' ? addYears(from, 1) : addDays(from, 30);
}

function couponFromMetadata(metadata?: Record<string, string>): CheckoutCoupon | undefined {
  const couponId = Number(metadata?.couponId);
  if (!couponId) return undefined;
  return {
    couponId,
    originalAmount: Number(metadata?.originalAmount ?? 0),
    discountAmount: Number(metadata?.discountAmount ?? 0),
  };
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly emailService: EmailService,
    private readonly couponsService: CouponsService,
  ) {}

  async newSubscription(userId: number, body: any) {
    this.logger.log(`Creating new subscription for user ${userId}`);

    const plan = await this.prisma.plan.findFirst({
      where: { id: body.planId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (!plan.stripePriceId) {
      throw new BadRequestException('Plan does not have a Stripe price ID configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verificar se já existe uma assinatura ativa
    const lastActiveSub = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
    });

    // Criar ou recuperar cliente Stripe
    let customer: Stripe.Customer;
    if (user.stripeCustomerId) {
      try {
        const customerResponse = await this.stripeService.getCustomer(user.stripeCustomerId);
        if (customerResponse.deleted) {
          throw new Error('Customer was deleted');
        }
        customer = customerResponse as Stripe.Customer;
      } catch (error) {
        this.logger.warn(`Stripe customer ${user.stripeCustomerId} not found, creating new one`);
        customer = await this.stripeService.createCustomer(user.email, user.fullName, {
          userId: userId.toString(),
        });
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customer.id },
        });
      }
    } else {
      customer = await this.stripeService.createCustomer(user.email, user.fullName, {
        userId: userId.toString(),
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
    }

    // Criar assinatura no Stripe
    const stripeSubscription = await this.stripeService.createSubscription(
      customer.id,
      plan.stripePriceId,
      {
        userId: userId.toString(),
        planId: plan.id.toString(),
      },
    );

    // Extrair payment intent com proteção
    let paymentIntent: Stripe.PaymentIntent | null = null;
    try {
      paymentIntent = (stripeSubscription as any).latest_invoice
        ?.payment_intent as Stripe.PaymentIntent;
    } catch (error) {
      this.logger.warn('Could not extract payment intent from subscription:', error);
    }

    if (!paymentIntent) {
      this.logger.warn('No payment intent found in subscription, creating one manually');
      // Criar payment intent manualmente se necessário
      paymentIntent = await this.stripeService.createPaymentIntent(
        Math.floor(Number(plan.price) * 100 + 0.5),
        'brl',
        customer.id,
      );
    }

    if (!lastActiveSub) {
      this.logger.log('No active subscription found, creating new one');

      const subscription = await this.prisma.subscription.create({
        data: {
          userId,
          planId: body.planId,
          startSubDate: new Date(),
          status: PLANO_STATUS.ACTIVE,
          stripeCustomerId: customer.id,
          stripeSubscriptionId: stripeSubscription.id,
        } as any,
      });

      await this.prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: new Prisma.Decimal(plan.price),
          nextPaymentDate:
            plan.billingCycle === 'YEARLY' ? addYears(new Date(), 1) : addDays(new Date(), 30),
          paymentDate: new Date(),
          paymentMethod: 'stripe',
          transactionId: paymentIntent.id,
          status: PAGAMENTO_STATUS.COMPLETED,
        },
      });

      return { subscription, paymentIntent };
    }

    this.logger.log(`Updating current subscription for user ${userId}`);

    // Cancelar assinatura anterior
    const startDay = format(lastActiveSub.startSubDate, 'd');
    await this.prisma.subscription.update({
      where: { id: lastActiveSub.id },
      data: {
        status: PLANO_STATUS.INACTIVE,
        cancelationDate: addDays(
          new Date(new Date().getFullYear(), new Date().getMonth(), +startDay + 1),
          +30,
        ),
      },
    });

    // Criar nova assinatura
    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        planId: body.planId,
        startSubDate: addDays(
          new Date(new Date().getFullYear(), new Date().getMonth(), +startDay + 1),
          +30,
        ),
        status: PLANO_STATUS.ACTIVE,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: stripeSubscription.id,
      } as any,
    });

    await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(plan.price),
        nextPaymentDate:
          plan.billingCycle === 'YEARLY' ? addYears(new Date(), 1) : addDays(new Date(), 30),
        paymentDate: new Date(),
        paymentMethod: 'stripe',
        transactionId: paymentIntent.id,
        status: PAGAMENTO_STATUS.COMPLETED,
      },
    });

    return { subscription, paymentIntent };
  }

  async getAll(userId: number) {
    this.logger.log(`Getting all payments for userId: ${userId}`);
    return this.prisma.subscription.findMany({
      where: { userId },
      include: { payments: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoices(userId: number) {
    this.logger.log(`Getting invoices for userId: ${userId}`);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`User not found for userId: ${userId}`);
      throw new NotFoundException('User not found');
    }
    this.logger.log(`User found: ${user.email}, stripeCustomerId: "${user.stripeCustomerId}"`);
    this.logger.log(`StripeCustomerId type: ${typeof user.stripeCustomerId}`);
    this.logger.log(`StripeCustomerId is null: ${user.stripeCustomerId === null}`);
    this.logger.log(`StripeCustomerId is empty string: ${user.stripeCustomerId === ''}`);
    this.logger.log(
      `StripeCustomerId trim check: ${
        user.stripeCustomerId && typeof user.stripeCustomerId === 'string'
          ? user.stripeCustomerId.trim() === ''
          : 'null or not string'
      }`,
    );

    if (
      !user.stripeCustomerId ||
      (typeof user.stripeCustomerId === 'string' && user.stripeCustomerId.trim() === '')
    ) {
      this.logger.log(`User ${userId} has no stripeCustomerId, returning empty array`);
      return [];
    }

    this.logger.log(`User ${userId} has valid stripeCustomerId, proceeding to fetch invoices`);

    try {
      const invoices = await this.stripeService.listInvoices(user.stripeCustomerId);
      this.logger.log(`Found ${invoices.data.length} invoices for user ${userId}`);
      return invoices.data.map((inv) => ({
        id: inv.id,
        date: new Date(inv.created * 1000),
        amount: inv.amount_paid / 100,
        status: inv.status,
        invoiceUrl: inv.hosted_invoice_url,
        dueDate: inv.due_date ? new Date(inv.due_date * 1000) : null,
      }));
    } catch (error) {
      this.logger.error(`Error fetching invoices for user ${userId}:`, error);
      throw new NotFoundException('Error fetching invoices from Stripe');
    }
  }

  async getLatestPendingInvoice(userId: number) {
    this.logger.log(`Getting latest pending invoice for userId: ${userId}`);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`User not found for userId: ${userId}`);
      throw new NotFoundException('User not found');
    }

    this.logger.log(`User found: ${user.email}, stripeCustomerId: "${user.stripeCustomerId}"`);
    this.logger.log(`StripeCustomerId type: ${typeof user.stripeCustomerId}`);
    this.logger.log(`StripeCustomerId is null: ${user.stripeCustomerId === null}`);
    this.logger.log(`StripeCustomerId is empty string: ${user.stripeCustomerId === ''}`);
    this.logger.log(
      `StripeCustomerId trim check: ${
        user.stripeCustomerId && typeof user.stripeCustomerId === 'string'
          ? user.stripeCustomerId.trim() === ''
          : 'null or not string'
      }`,
    );

    if (
      !user.stripeCustomerId ||
      (typeof user.stripeCustomerId === 'string' && user.stripeCustomerId.trim() === '')
    ) {
      this.logger.log(`User ${userId} has no stripeCustomerId, returning null`);
      return null;
    }

    this.logger.log(
      `User ${userId} has valid stripeCustomerId, proceeding to fetch pending invoice`,
    );

    try {
      const invoices = await this.stripeService.listInvoices(user.stripeCustomerId, {
        status: 'open',
        limit: 1,
      });

      this.logger.log(`Found ${invoices.data.length} pending invoices for user ${userId}`);

      const invoice = invoices.data[0];

      if (invoice) {
        if (invoice.due_date && invoice.due_date * 1000 < Date.now()) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { membership: MEMBERSHIP_STATUS.PAST_DUE, isActive: false },
          });
        }

        return {
          id: invoice.id,
          amount: invoice.amount_due / 100,
          status: invoice.status,
          dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
          invoiceUrl: invoice.hosted_invoice_url,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Error fetching pending invoice for user ${userId}:`, error);
      throw new NotFoundException('Error fetching pending invoice from Stripe');
    }
  }

  async getOne(userId: number, id: number) {
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, AND: { id } },
      include: { payments: true, plan: true },
    });

    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }

    return sub;
  }

  async updatePaymentMethod(userId: number, paymentMethodId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      throw new NotFoundException('Stripe customer not found');
    }

    // Anexar método de pagamento ao cliente
    await this.stripeService.attachPaymentMethod(paymentMethodId, user.stripeCustomerId);

    // Definir como método padrão
    await this.stripeService.setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId);

    return { success: true };
  }

  async changePlan(userId: number, newPlanId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
      include: { plan: true, payments: { orderBy: { paymentDate: 'desc' }, take: 1 } },
    });

    if (!subscription) {
      throw new NotFoundException('You do not have any active subscription');
    }

    const newPlan = await this.prisma.plan.findUnique({ where: { id: newPlanId } });
    if (!newPlan) {
      throw new BadRequestException('Plan not found');
    }

    if (!newPlan.stripePriceId) {
      throw new BadRequestException('New plan does not have a Stripe price ID configured');
    }

    if (subscription.planId === newPlanId) {
      return subscription;
    }

    const priceDiff = Number(newPlan.price) - Number(subscription.plan.price);
    const lastPayment = subscription.payments[0];
    const nextPaymentDate = lastPayment?.nextPaymentDate || addDays(new Date(), 30);

    // Atualizar assinatura no Stripe com proration_behavior: 'none' para não cobrar imediatamente
    if (subscription.stripeSubscriptionId) {
      try {
        await this.stripeService.updateSubscription(subscription.stripeSubscriptionId, {
          items: [{ id: subscription.stripeSubscriptionId, price: newPlan.stripePriceId }],
          proration_behavior: 'none', // Não cobra imediatamente, apenas no próximo vencimento
        });
      } catch (error) {
        this.logger.error(`Failed to update Stripe subscription: ${error.message}`);
        throw new BadRequestException('Failed to update subscription in Stripe');
      }
    }

    // Atualizar o plano no banco de dados
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { planId: newPlanId },
    });

    // O preço novo vale a partir do próximo vencimento (a renovação cobra o
    // plano atual). Antes a diferença virava um pagamento "pendente" que o
    // job cobrava todo dia — a pendência nunca era baixada.
    this.logger.log(
      `Plan change for user ${userId}: ${subscription.plan.name} -> ${newPlan.name} (price diff ${priceDiff}, from next renewal)`,
    );

    return { subscription: updated, paymentIntent: undefined };
  }

  async unsubscribe(userId: number) {
    const lastActiveSub = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
    });

    if (!lastActiveSub) {
      throw new NotFoundException('You do not have any active subscription');
    }

    if (lastActiveSub.stripeSubscriptionId) {
      try {
        await this.stripeService.cancelSubscription(lastActiveSub.stripeSubscriptionId);
      } catch (error) {
        this.logger.error(`Failed to cancel stripe subscription for userId: ${userId}`, error);
      }
    }

    const startDay = format(lastActiveSub.startSubDate, 'd');
    const subscription = await this.prisma.subscription.update({
      where: { id: lastActiveSub.id },
      data: {
        status: PLANO_STATUS.INACTIVE,
        cancelationDate: addDays(
          new Date(new Date().getFullYear(), new Date().getMonth(), +startDay + 1),
          +30,
        ),
      },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { membership: MEMBERSHIP_STATUS.FREE, isActive: false },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      const context = {
        FullName: user.fullName,
        AppName: 'Barbershop',
        ReactivateURL: 'https://app.barbershop.com/plans',
        SupportEmail: 'suporte@barbershop.com.br',
        Year: new Date().getFullYear(),
      };

      try {
        await this.emailService.sendTemplateEmail(
          user.id,
          'plan_canceled_email',
          context,
          { pt: 'Plano cancelado', en: 'Plan canceled', es: 'Plan cancelado' },
          'cancel-plan',
          user.email,
        );
      } catch (error) {
        this.logger.error(`Failed to send cancellation email to ${user.email}`, error);
      }
    }

    return subscription;
  }

  async getPaymentMethods(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      throw new NotFoundException('Stripe customer not found');
    }

    const paymentMethods = await this.stripeService.listPaymentMethods(user.stripeCustomerId);
    return paymentMethods.data.map((pm) => ({
      id: pm.id,
      type: pm.type,
      card: pm.card
        ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          }
        : null,
    }));
  }

  async createSetupIntent(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeCustomerId: true,
        email: true,
        fullName: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let stripeCustomerId = user.stripeCustomerId;

    // Se o usuário não tem stripeCustomerId, criar um
    if (!stripeCustomerId) {
      this.logger.log(`User ${userId} has no stripeCustomerId, creating one`);

      const customer = await this.stripeService.createCustomer(
        user.email,
        user.fullName || user.email,
        { userId: userId.toString() },
      );

      stripeCustomerId = customer.id;

      // Atualizar usuário com o novo stripeCustomerId
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId },
      });

      this.logger.log(`Created Stripe customer ${stripeCustomerId} for user ${userId}`);
    }

    return await this.stripeService.createSetupIntent(stripeCustomerId);
  }

  async deletePaymentMethod(paymentMethodId: string) {
    this.logger.log(`Deleting payment method: ${paymentMethodId}`);

    try {
      await this.stripeService.detachPaymentMethod(paymentMethodId);
      return { success: true, message: 'Payment method deleted successfully' };
    } catch (error) {
      this.logger.error('Error deleting payment method:', error);
      throw error;
    }
  }

  async testPaymentIntentCreation(planId: number) {
    this.logger.log(`Testing PaymentIntent creation for plan ${planId}`);

    const plan = await this.prisma.plan.findFirst({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    if (!plan.stripePriceId) {
      throw new BadRequestException('Plan does not have a Stripe price ID configured');
    }

    const user = await this.prisma.user.findUnique({ where: { id: 1 } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create customer
    const customer = await this.stripeService.createCustomer(user.email, user.fullName, {
      userId: '1',
    });

    // Create PaymentIntent
    const paymentIntent = await this.stripeService.createPaymentIntent(
      Math.floor(Number(plan.price) * 100 + 0.5),
      'brl',
      customer.id,
    );

    return {
      success: true,
      paymentIntent: {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      },
      customer: {
        id: customer.id,
        email: customer.email,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        stripePriceId: plan.stripePriceId,
      },
    };
  }

  async createPaymentIntentForCheckout(userId: number, planId: number, couponCode?: string) {
    this.logger.log(`Creating payment intent for user ${userId}, plan ${planId}`);

    const plan = await this.prisma.plan.findFirst({
      where: { id: planId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.isActive) {
      throw new Error('User is not active');
    }

    // Cupom: valida pro usuário e o plano e cobra o valor com desconto (o
    // desconto nunca passa do preço — cupom de valor fixo podia passar)
    const price = Number(plan.price);
    let coupon: CheckoutCoupon | undefined;
    if (couponCode?.trim()) {
      const validation = await this.couponsService.validateCoupon(
        couponCode.trim(),
        userId,
        planId,
        price,
      );
      if (!validation.isValid) {
        throw new BadRequestException(validation.error || 'Cupom inválido');
      }
      const discountAmount = roundMoney(Math.min(price, validation.discountAmount));
      coupon = { couponId: validation.coupon.id, originalAmount: price, discountAmount };
    }
    const finalAmount = roundMoney(price - (coupon?.discountAmount ?? 0));

    // O Stripe não cria cobrança abaixo de R$ 0,50: cupom que cobre o valor
    // (ex.: "1 mês grátis" do convite de amigo) ativa o plano sem cobrança
    if (coupon && finalAmount < MIN_STRIPE_CHARGE) {
      await this.createSubscriptionAfterPayment(userId, planId, null, {
        ...coupon,
        discountAmount: price,
      });
      return {
        clientSecret: null,
        paymentIntentId: null,
        activated: true,
        originalAmount: price,
        discountAmount: price,
        finalAmount: 0,
      };
    }

    let customer: Stripe.Customer;
    if (user.stripeCustomerId) {
      try {
        const customerResponse = await this.stripeService.getCustomer(user.stripeCustomerId);
        if (customerResponse.deleted) {
          throw new Error('Customer was deleted');
        }
        customer = customerResponse as Stripe.Customer;
      } catch (error) {
        customer = await this.stripeService.createCustomer(user.email, user.fullName, {
          userId: userId.toString(),
        });
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customer.id },
        });
      }
    } else {
      customer = await this.stripeService.createCustomer(user.email, user.fullName, {
        userId: userId.toString(),
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customer.id },
      });
    }

    const amountInCents = Math.floor(finalAmount * 100 + 0.5);
    // setup_future_usage: o cartão fica salvo no cliente pra renovação
    // automática no vencimento (antes nada renovava: pagava uma vez e o
    // plano ficava ativo pra sempre)
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amountInCents,
      'brl',
      customer.id,
      { setupFutureUsage: 'off_session' },
    );

    await this.stripeService.updatePaymentIntent(paymentIntent.id, {
      metadata: {
        userId: userId.toString(),
        planId: plan.id.toString(),
        planName: plan.name,
        // Lidos de volta no confirmPaymentIntent pra registrar o cupom
        ...(coupon && {
          couponId: String(coupon.couponId),
          originalAmount: String(coupon.originalAmount),
          discountAmount: String(coupon.discountAmount),
        }),
      },
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      activated: false,
      originalAmount: price,
      discountAmount: coupon?.discountAmount ?? 0,
      finalAmount,
    };
  }

  async confirmPaymentIntent(paymentIntentId: string) {
    this.logger.log(`Confirming PaymentIntent: ${paymentIntentId}`);

    try {
      // First, retrieve the PaymentIntent to check its current status
      const existingPaymentIntent = await this.stripeService.retrievePaymentIntent(paymentIntentId);
      this.logger.log(`PaymentIntent current status: ${existingPaymentIntent.status}`);

      let paymentIntent;

      if (existingPaymentIntent.status === 'succeeded') {
        // PaymentIntent is already confirmed, use the existing one
        this.logger.log(
          `PaymentIntent ${paymentIntentId} is already succeeded, skipping confirmation`,
        );
        paymentIntent = existingPaymentIntent;
      } else {
        // PaymentIntent needs to be confirmed
        this.logger.log(`Confirming PaymentIntent ${paymentIntentId}...`);
        paymentIntent = await this.stripeService.confirmPaymentIntent(paymentIntentId);
      }

      if (paymentIntent.status === 'succeeded') {
        // Extrair metadados
        const userId = parseInt(paymentIntent.metadata?.userId || '0');
        const planId = parseInt(paymentIntent.metadata?.planId || '0');

        if (userId && planId) {
          // Criar assinatura após pagamento confirmado
          return await this.createSubscriptionAfterPayment(
            userId,
            planId,
            paymentIntent.id,
            couponFromMetadata(paymentIntent.metadata),
            typeof paymentIntent.payment_method === 'string'
              ? paymentIntent.payment_method
              : paymentIntent.payment_method?.id,
          );
        }
      }

      return { success: true, paymentIntent };
    } catch (error) {
      // Handle the specific case where PaymentIntent is already confirmed
      if (error.message && error.message.includes('already succeeded')) {
        this.logger.log(`PaymentIntent ${paymentIntentId} was already confirmed, retrieving it...`);
        try {
          const paymentIntent = await this.stripeService.retrievePaymentIntent(paymentIntentId);

          if (paymentIntent.status === 'succeeded') {
            const userId = parseInt(paymentIntent.metadata?.userId || '0');
            const planId = parseInt(paymentIntent.metadata?.planId || '0');

            if (userId && planId) {
              return await this.createSubscriptionAfterPayment(
                userId,
                planId,
                paymentIntent.id,
                couponFromMetadata(paymentIntent.metadata),
              );
            }
          }

          return { success: true, paymentIntent };
        } catch (retrieveError) {
          this.logger.error('Error retrieving already-succeeded PaymentIntent:', retrieveError);
          throw retrieveError;
        }
      }

      this.logger.error('Error confirming PaymentIntent:', error);
      throw error;
    }
  }

  private async createSubscriptionAfterPayment(
    userId: number,
    planId: number,
    paymentIntentId: string | null,
    coupon?: CheckoutCoupon,
    paymentMethodId?: string,
  ) {
    this.logger.log(`Creating subscription after payment - User: ${userId}, Plan: ${planId}`);

    const plan = await this.prisma.plan.findFirst({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const periodEnd = addCycle(now, plan.billingCycle);
    const price = Number(plan.price);

    // A tela e o webhook do Stripe confirmam o mesmo pagamento, às vezes ao
    // mesmo tempo: a trava por pagamento garante uma assinatura só
    const result = await this.prisma.$transaction(async (tx) => {
      if (paymentIntentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${
          'checkout:' + paymentIntentId
        }))`;
        const existing = await tx.payment.findFirst({
          where: { transactionId: paymentIntentId },
          include: { subscription: true },
        });
        if (existing?.subscription) return { subscription: existing.subscription, created: false };
      }

      // A assinatura anterior (ex.: o Free) é encerrada
      await tx.subscription.updateMany({
        where: { userId, status: PLANO_STATUS.ACTIVE },
        data: { status: PLANO_STATUS.INACTIVE, cancelationDate: now },
      });

      const subscription = await tx.subscription.create({
        data: {
          userId,
          planId,
          startSubDate: now,
          status: PLANO_STATUS.ACTIVE,
          stripeCustomerId: user.stripeCustomerId,
          currentPeriodEnd: periodEnd,
        },
      });

      await tx.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: new Prisma.Decimal(coupon ? roundMoney(price - coupon.discountAmount) : price),
          nextPaymentDate: periodEnd,
          paymentDate: now,
          paymentMethod: paymentIntentId ? 'stripe' : 'coupon',
          transactionId: paymentIntentId,
          status: PAGAMENTO_STATUS.COMPLETED,
          ...(coupon && {
            appliedCouponId: coupon.couponId,
            originalAmount: new Prisma.Decimal(coupon.originalAmount),
            discountAmount: new Prisma.Decimal(coupon.discountAmount),
          }),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { membership: MEMBERSHIP_STATUS.PAID },
      });
      return { subscription, created: true };
    });

    if (result.created) {
      if (coupon) await this.couponsService.registerUse(coupon.couponId, userId);
      // O cartão usado vira o padrão: é ele que a renovação cobra
      if (paymentMethodId && user.stripeCustomerId) {
        await this.stripeService
          .setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId)
          .catch((e) => this.logger.warn(`Cartão padrão não definido (user ${userId}): ${e}`));
      }
    }
    return { success: true, subscription: result.subscription };
  }

  /**
   * Job diário: renova os planos vencidos cobrando o cartão salvo.
   *
   * Seguro contra cobrança em dobro — mesmo com o botão "processar" do
   * backoffice rodando junto com o agendamento:
   * - antes de cobrar, a renovação cria o pagamento PENDENTE com
   *   renewalKey única (assinatura:vencimento:tentativa); quem não
   *   conseguir criar, não cobra
   * - a cobrança no Stripe usa essa mesma chave como idempotencyKey
   * - pagamento pendente de uma execução que caiu no meio é conferido no
   *   Stripe antes de qualquer nova tentativa
   * Cartão recusado: uma tentativa por dia, aviso por e-mail na primeira, e
   * o plano cai depois de RENEWAL_GRACE_DAYS do vencimento.
   */
  async processRecurringPayments() {
    const due = await this.prisma.subscription.findMany({
      where: {
        status: PLANO_STATUS.ACTIVE,
        stripeSubscriptionId: null,
        currentPeriodEnd: { lte: new Date() },
      },
      select: { id: true },
    });
    this.logger.log(`Renovação: ${due.length} plano(s) vencido(s)`);
    let renewed = 0;
    for (const { id } of due) {
      try {
        if ((await this.renewSubscription(id)) === 'renewed') renewed++;
      } catch (error) {
        this.logger.error(`Renovação da assinatura ${id} falhou: ${error}`);
      }
    }
    return { processed: due.length, renewed };
  }

  /** Renova uma assinatura se estiver vencida (nada acontece se não estiver). */
  async renewSubscription(
    subscriptionId: number,
  ): Promise<'renewed' | 'not_due' | 'in_progress' | 'failed' | 'expired'> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, user: true },
    });
    const now = new Date();
    if (
      !sub ||
      sub.status !== PLANO_STATUS.ACTIVE ||
      sub.stripeSubscriptionId ||
      !sub.currentPeriodEnd ||
      sub.currentPeriodEnd > now
    ) {
      return 'not_due';
    }
    const periodEnd = sub.currentPeriodEnd;
    const keyPrefix = `${sub.id}:${periodEnd.toISOString()}:`;

    // Plano gratuito: só avança o período
    const price = Number(sub.plan.price);
    if (price <= 0) {
      await this.prisma.subscription.updateMany({
        where: { id: sub.id, currentPeriodEnd: periodEnd },
        data: { currentPeriodEnd: addCycle(periodEnd, sub.plan.billingCycle) },
      });
      return 'renewed';
    }

    // Execução anterior que caiu com a cobrança em andamento: confere no Stripe
    const pending = await this.prisma.payment.findFirst({
      where: { renewalKey: { startsWith: keyPrefix }, status: PAGAMENTO_STATUS.PENDING },
    });
    if (pending) {
      const outcome = await this.reconcileRenewalPayment(pending.id);
      if (outcome !== 'failed') return outcome;
    }

    // Uma tentativa por dia
    if (sub.renewalFailedAt) {
      const lastAttempt = await this.prisma.payment.findFirst({
        where: { renewalKey: { startsWith: keyPrefix } },
        orderBy: { createdAt: 'desc' },
      });
      if (lastAttempt && now.getTime() - lastAttempt.createdAt.getTime() < 20 * 3600_000) {
        return 'failed';
      }
    }

    // Tolerância esgotada: o plano cai (sem nova cobrança)
    if (now.getTime() - periodEnd.getTime() > RENEWAL_GRACE_DAYS * 86400_000) {
      await this.expireSubscription(sub.id, sub.userId);
      return 'expired';
    }

    // Só as tentativas que falharam contam: duas execuções juntas chegam no
    // mesmo número, e a trava (renewalKey única) deixa só uma cobrar
    const attempt =
      (await this.prisma.payment.count({
        where: { renewalKey: { startsWith: keyPrefix }, status: PAGAMENTO_STATUS.FAILED },
      })) + 1;
    const renewalKey = `${keyPrefix}${attempt}`;
    const nextPeriodEnd = addCycle(periodEnd, sub.plan.billingCycle);

    // A trava: só quem cria este pagamento cobra
    let claim;
    try {
      claim = await this.prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          amount: new Prisma.Decimal(price),
          paymentDate: now,
          nextPaymentDate: nextPeriodEnd,
          paymentMethod: 'stripe',
          status: PAGAMENTO_STATUS.PENDING,
          renewalKey,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return 'in_progress';
      }
      throw e;
    }

    const paymentMethodId = sub.user.stripeCustomerId
      ? await this.stripeService.getDefaultPaymentMethodId(sub.user.stripeCustomerId)
      : null;
    if (!sub.user.stripeCustomerId || !paymentMethodId) {
      await this.markRenewalFailed(claim.id, 'Nenhum cartão salvo pra renovar o plano');
      return 'failed';
    }

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripeService.chargeOffSession({
        amount: Math.round(price * 100),
        currency: 'brl',
        customerId: sub.user.stripeCustomerId,
        paymentMethodId,
        metadata: { renewalKey, subscriptionId: String(sub.id), userId: String(sub.userId) },
        idempotencyKey: `renewal:${renewalKey}`,
      });
    } catch (error: any) {
      // Cartão recusado: o Stripe devolve o PaymentIntent no erro
      const pi = error?.raw?.payment_intent ?? error?.payment_intent;
      if (pi?.id) {
        await this.prisma.payment.update({
          where: { id: claim.id },
          data: { transactionId: pi.id },
        });
      }
      if (error?.type === 'StripeCardError' || pi) {
        await this.markRenewalFailed(claim.id, error?.message ?? 'Cartão recusado');
        return 'failed';
      }
      // Erro de rede/Stripe fora: o pagamento fica PENDENTE e a próxima
      // execução confere no Stripe (mesma idempotencyKey) antes de tentar de novo
      throw error;
    }

    await this.prisma.payment.update({
      where: { id: claim.id },
      data: { transactionId: paymentIntent.id },
    });
    if (paymentIntent.status === 'succeeded') {
      await this.finalizeRenewalPayment(claim.id);
      return 'renewed';
    }
    // requires_action (3DS) ou processing: fica pendente; o webhook ou a
    // próxima execução resolve
    return 'in_progress';
  }

  /** Confere no Stripe um pagamento de renovação pendente e fecha o resultado. */
  private async reconcileRenewalPayment(
    paymentId: number,
  ): Promise<'renewed' | 'in_progress' | 'failed'> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== PAGAMENTO_STATUS.PENDING) return 'failed';
    let transactionId = payment.transactionId;
    if (!transactionId) {
      // A execução caiu no meio da chamada ao Stripe: não dá pra saber se a
      // cobrança foi criada. Espera 1 h (a busca do Stripe tem atraso) e
      // procura pela renewalKey — só dá como falha se ela não existir lá.
      // Nunca tenta de novo às cegas: seria cobrar duas vezes.
      if (Date.now() - payment.createdAt.getTime() < 3600_000) return 'in_progress';
      const found = await this.stripeService.findPaymentIntentByRenewalKey(payment.renewalKey!);
      if (!found) {
        await this.markRenewalFailed(payment.id, 'Cobrança interrompida');
        return 'failed';
      }
      transactionId = found.id;
      await this.prisma.payment.update({ where: { id: payment.id }, data: { transactionId } });
    }
    const pi = await this.stripeService.retrievePaymentIntent(transactionId);
    if (pi.status === 'succeeded') {
      await this.finalizeRenewalPayment(payment.id);
      return 'renewed';
    }
    if (pi.status === 'processing' || pi.status === 'requires_action') return 'in_progress';
    await this.markRenewalFailed(payment.id, `Cobrança não concluída (${pi.status})`);
    return 'failed';
  }

  /**
   * Renovação paga: baixa o pagamento e empurra o vencimento. Idempotente
   * (webhook e job podem chegar juntos): só quem baixa o pendente avança.
   */
  async finalizeRenewalPayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { subscription: { include: { plan: true, user: true } } },
    });
    if (!payment?.renewalKey) return;
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: PAGAMENTO_STATUS.PENDING },
        data: { status: PAGAMENTO_STATUS.COMPLETED, paymentDate: new Date() },
      });
      if (count === 0) return false;
      await tx.subscription.update({
        where: { id: payment.subscriptionId },
        data: {
          currentPeriodEnd: payment.nextPaymentDate,
          renewalFailedAt: null,
          status: PLANO_STATUS.ACTIVE,
        },
      });
      await tx.user.update({
        where: { id: payment.subscription.userId },
        data: { membership: MEMBERSHIP_STATUS.PAID },
      });
      return true;
    });
    if (!done) return;

    const { user, plan } = payment.subscription;
    this.logger.log(
      `Plano renovado: assinatura ${
        payment.subscriptionId
      } até ${payment.nextPaymentDate.toISOString()}`,
    );
    await this.emailService
      .sendTemplateEmail(
        user.id,
        'recurring_payment_success',
        {
          FullName: user.fullName,
          AppName: 'Barbershop',
          InvoiceID: payment.transactionId,
          Amount: Number(payment.amount),
          Currency: 'BRL',
          PaymentDate: new Date(),
          DueDate: payment.nextPaymentDate,
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        {
          pt: `Pagamento recorrente processado - ${plan.name}`,
          en: `Recurring payment processed - ${plan.name}`,
          es: `Pago recurrente procesado - ${plan.name}`,
        },
        'recurring_payment',
        user.email,
      )
      .catch((e) => this.logger.error(`E-mail de renovação não enviado (user ${user.id}): ${e}`));
  }

  /**
   * Renovação recusada. O plano continua ativo durante a tolerância; a
   * pessoa é avisada na primeira falha do período (não todo dia).
   */
  private async markRenewalFailed(paymentId: number, reason: string) {
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PAGAMENTO_STATUS.FAILED },
      include: { subscription: { include: { plan: true, user: true } } },
    });
    const sub = payment.subscription;
    const firstFailure = !sub.renewalFailedAt;
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { renewalFailedAt: sub.renewalFailedAt ?? new Date() },
    });
    await this.prisma.user.update({
      where: { id: sub.userId },
      data: { membership: MEMBERSHIP_STATUS.PAST_DUE },
    });
    this.logger.warn(`Renovação recusada (assinatura ${sub.id}): ${reason}`);
    if (!firstFailure) return;
    await this.emailService
      .sendTemplateEmail(
        sub.user.id,
        'recurring_payment_failed',
        {
          FullName: sub.user.fullName,
          AppName: 'Barbershop',
          PlanName: sub.plan.name,
          Amount: Number(payment.amount),
          Currency: 'BRL',
          Reason: reason,
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        {
          pt: `Falha no pagamento recorrente - ${sub.plan.name}`,
          en: `Recurring payment failed - ${sub.plan.name}`,
          es: `Falló el pago recurrente - ${sub.plan.name}`,
        },
        'payment_failed',
        sub.user.email,
      )
      .catch((e) => this.logger.error(`E-mail de falha não enviado (user ${sub.userId}): ${e}`));
  }

  /** Tolerância esgotada sem pagamento: o plano cai pro gratuito. */
  private async expireSubscription(subscriptionId: number, userId: number) {
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: PLANO_STATUS.INACTIVE, cancelationDate: new Date() },
    });
    // Volta pro gratuito, como no cadastro (sem assinatura nenhuma a conta
    // ficaria sem plano)
    const freePlan = await this.prisma.plan.findFirst({
      where: { price: 0 },
      orderBy: { id: 'asc' },
    });
    if (freePlan) {
      await this.prisma.subscription.create({
        data: {
          userId,
          planId: freePlan.id,
          startSubDate: new Date(),
          status: PLANO_STATUS.ACTIVE,
        },
      });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { membership: MEMBERSHIP_STATUS.FREE },
    });
    this.logger.warn(`Plano vencido sem pagamento: assinatura ${subscriptionId} encerrada`);
  }

  /**
   * Busca pagamentos vencidos para relatórios
   */
  async getOverduePayments() {
    const payments = await this.prisma.payment.findMany({
      where: {
        nextPaymentDate: {
          lte: new Date(),
        },
        status: PAGAMENTO_STATUS.COMPLETED,
        subscription: OVERDUE_SUBSCRIPTION_FILTER(),
      },
      include: {
        subscription: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                membership: true,
              },
            },
            plan: {
              select: {
                id: true,
                name: true,
                price: true,
                billingCycle: true,
              },
            },
          },
        },
      },
      orderBy: {
        nextPaymentDate: 'asc',
      },
    });
    return latestPerSubscription(payments);
  }

  /**
   * Força o processamento de um pagamento recorrente específico
   */
  async forceRecurringPayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    // Antes cobrava o preço do plano de novo, mesmo de um pagamento já pago.
    // Agora só renova se a assinatura estiver vencida.
    const outcome = await this.renewSubscription(payment.subscriptionId);
    return {
      success: outcome === 'renewed',
      message:
        outcome === 'not_due'
          ? 'O plano não está vencido: nada foi cobrado'
          : `Renovação: ${outcome}`,
    };
  }

  // Métodos para cupons de desconto
  async validateCoupon(code: string, userId: number, planId: number, amount: number) {
    return await this.couponsService.validateCoupon(code, userId, planId, amount);
  }

  async applyCouponToPayment(couponCode: string, userId: number, paymentId: number) {
    this.logger.log(`Applying coupon ${couponCode} to payment ${paymentId}`);

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    if (payment.status === PAGAMENTO_STATUS.COMPLETED) {
      throw new BadRequestException('Pagamento já foi realizado');
    }

    // Validar cupom
    const validation = await this.couponsService.validateCoupon(
      couponCode,
      userId,
      payment.subscription.plan.id,
      Number(payment.amount),
    );

    if (!validation.isValid) {
      throw new BadRequestException(validation.error);
    }

    // Aplicar cupom
    const result = await this.couponsService.applyCoupon(validation.coupon.id, userId, paymentId);

    // Se o valor final for 0, marcar como pago
    if (result.finalAmount === 0) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: PAGAMENTO_STATUS.COMPLETED,
          paymentDate: new Date(),
        },
      });
    }

    return {
      success: true,
      finalAmount: result.finalAmount,
      discountAmount: result.discountAmount,
      coupon: validation.coupon,
    };
  }

  async getAvailableCoupons(userId: number) {
    return await this.couponsService.getCouponsForUser(userId);
  }
}
