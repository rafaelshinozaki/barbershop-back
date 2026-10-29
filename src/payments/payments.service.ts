// src\payments\payments.service.ts
import { must } from '../common/must';
import { PAGAMENTO_STATUS, PLANO_STATUS, MEMBERSHIP_STATUS } from '@/common';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { addDays, addYears } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { StripeService } from '../stripe/stripe.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from './coupons.service';
import { rewardInviterOnFirstPayment } from './friend-invite.service';
import Stripe from 'stripe';
import { appUrl, supportEmail } from '../common/app-urls';
import { timeZoneForOwner } from '../common/owner-timezone';
import { BarbershopService } from '../barbershop/barbershop.service';

/** Cupom aplicado no checkout do plano (valores em reais). */
interface CheckoutCoupon {
  couponId: number;
  originalAmount: number;
  discountAmount: number;
}

/** Menor cobrança que o Stripe aceita em BRL. */
const MIN_STRIPE_CHARGE = 0.5;

const roundMoney = (value: number) => Math.round(value * 100) / 100;

export const CHECKOUT_HAS_PAID_PLAN = 'Você já tem um plano pago. Use a troca de plano.';

/** Plano pago em vigor, ou cobrado pela Stripe: o checkout não substitui a troca. */
export function blocksNewCheckout(
  sub: {
    stripeSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
    plan: { price: Prisma.Decimal | number };
  } | null,
  now = new Date(),
) {
  if (!sub || Number(sub.plan.price) <= 0) return false;
  if (sub.stripeSubscriptionId) return true;
  return sub.currentPeriodEnd != null && sub.currentPeriodEnd > now;
}

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

/** Duração do ciclo, pra proporção da troca de plano */
function cycleMs(billingCycle: string) {
  return (billingCycle === 'YEARLY' ? 365 : 30) * 86400_000;
}

/** Preço por mês, pra saber se a troca sobe ou desce de plano */
function monthlyPrice(plan: { price: Prisma.Decimal | number; billingCycle: string }) {
  return Number(plan.price) / (plan.billingCycle === 'YEARLY' ? 12 : 1);
}

export const COUPON_REFUSED_MESSAGE =
  'O cupom já tinha sido usado em outra compra. O pagamento foi estornado: faça o pedido de novo.';

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
    // Confere o uso (unidades, vagas) antes de agendar um plano menor
    @Optional() private readonly barbershops?: BarbershopService,
  ) {}

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
            data: { membership: MEMBERSHIP_STATUS.PAST_DUE },
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

  /**
   * Troca de plano. Subir cobra na hora a diferença proporcional ao que falta
   * do período (no cartão salvo) e só então libera o limite novo. Descer
   * confere se o uso de hoje cabe no plano menor e agenda a troca pra
   * renovação: o plano atual vale até lá. Antes o limite mudava na hora e o
   * preço só na renovação (dava pra usar o maior o mês todo e voltar na véspera).
   */
  async changePlan(userId: number, newPlanId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
      include: { plan: true, payments: { orderBy: { paymentDate: 'desc' }, take: 1 } },
    });

    if (!subscription) {
      throw new NotFoundException('You do not have any active subscription');
    }

    // O próprio plano pode ter saído da lista (versão nova com outro preço,
    // item 351): escolher o atual continua valendo para desfazer o agendado
    const newPlan =
      subscription.planId === newPlanId
        ? subscription.plan
        : await this.prisma.plan.findUnique({ where: { id: newPlanId } });
    if (!newPlan) {
      throw new BadRequestException('Plan not found');
    }

    // Mesmo plano: desfaz o que estava agendado (plano menor ou cancelamento)
    if (subscription.planId === newPlanId) {
      if (!subscription.pendingPlanId && !subscription.cancelAtPeriodEnd) return subscription;
      if (subscription.stripeSubscriptionId && subscription.cancelAtPeriodEnd) {
        await this.updateStripeSubscription(subscription.stripeSubscriptionId, {
          cancel_at_period_end: false,
        });
      }
      const updated = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { pendingPlanId: null, cancelAtPeriodEnd: false, cancelationDate: null },
      });
      return { subscription: updated, paymentIntent: undefined };
    }

    if (Number(newPlan.price) <= 0) {
      throw new BadRequestException(
        'Para voltar ao plano gratuito, cancele a assinatura: o plano atual vale até o vencimento',
      );
    }
    const now = new Date();
    if (
      Number(subscription.plan.price) <= 0 ||
      (!subscription.stripeSubscriptionId && !subscription.currentPeriodEnd)
    ) {
      throw new BadRequestException('Assine o plano pelo pagamento');
    }
    if (
      !subscription.stripeSubscriptionId &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd <= now
    ) {
      throw new BadRequestException('Regularize o pagamento do plano antes de trocar');
    }
    if (subscription.stripeSubscriptionId && !newPlan.stripePriceId) {
      throw new BadRequestException('New plan does not have a Stripe price ID configured');
    }

    // Mensal → anual sobe na hora (o período recomeça); anual → mensal fica
    // pra renovação (o anual já pago vale até o fim)
    const oldCycle = subscription.plan.billingCycle;
    const upgrade =
      oldCycle === newPlan.billingCycle
        ? monthlyPrice(newPlan) > monthlyPrice(subscription.plan)
        : newPlan.billingCycle === 'YEARLY';
    if (!upgrade) {
      // Plano menor: o uso de hoje tem de caber nele
      await this.barbershops?.assertUsageFitsPlan(userId, newPlan.name);
      if (subscription.stripeSubscriptionId) {
        // O preço novo vale a partir da próxima fatura; o plano no banco
        // muda quando ela é paga (webhook)
        await this.updateStripeSubscription(subscription.stripeSubscriptionId, {
          price: must(newPlan.stripePriceId, 'preço do plano na Stripe'),
          proration_behavior: 'none',
          cancel_at_period_end: false,
        });
      }
      const updated = await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { pendingPlanId: newPlanId, cancelAtPeriodEnd: false, cancelationDate: null },
      });
      this.logger.log(
        `Plan change for user ${userId}: ${subscription.plan.name} -> ${newPlan.name} at renewal`,
      );
      return { subscription: updated, paymentIntent: undefined, scheduled: true };
    }

    // Plano maior: cobra a diferença antes de liberar
    let currentPeriodEnd = subscription.currentPeriodEnd;
    if (subscription.stripeSubscriptionId) {
      // A Stripe fatura a proporção na hora e recusa se o cartão não passar
      await this.updateStripeSubscription(subscription.stripeSubscriptionId, {
        price: must(newPlan.stripePriceId, 'preço do plano na Stripe'),
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        cancel_at_period_end: false,
      });
    } else {
      currentPeriodEnd = await this.chargeUpgrade(subscription, newPlan, now);
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: newPlanId,
        pendingPlanId: null,
        cancelAtPeriodEnd: false,
        cancelationDate: null,
        currentPeriodEnd,
      },
    });
    this.logger.log(
      `Plan change for user ${userId}: ${subscription.plan.name} -> ${newPlan.name} (upgrade, charged now)`,
    );
    return { subscription: updated, paymentIntent: undefined };
  }

  /**
   * Plano trocado pela equipe no backoffice (o banco já mudou): a assinatura
   * antiga da Stripe passa pro preço do plano novo a partir da próxima
   * fatura, sem cobrar diferença. Sem assinatura na Stripe, nada a fazer.
   */
  async syncStripePlanPrice(userIds: number[]) {
    const subs = await this.prisma.subscription.findMany({
      where: {
        userId: { in: userIds },
        status: PLANO_STATUS.ACTIVE,
        stripeSubscriptionId: { not: null },
      },
      include: { plan: true },
    });
    for (const sub of subs) {
      const id = must(sub.stripeSubscriptionId, 'assinatura na Stripe');
      if (!sub.plan.stripePriceId) {
        this.logger.warn(`Plano ${sub.plan.name} sem preço na Stripe: assinatura ${id} não mudou`);
        continue;
      }
      const current = await this.stripeService.getSubscription(id);
      const item = current.items.data[0];
      if (!item || item.price?.id === sub.plan.stripePriceId) continue;
      await this.stripeService.updateSubscription(id, {
        items: [{ id: item.id, price: sub.plan.stripePriceId }],
        proration_behavior: 'none',
      });
      this.logger.log(`Assinatura ${id} no preço do plano ${sub.plan.name} (backoffice)`);
    }
  }

  /** Troca o preço (ou só as opções) da assinatura antiga na Stripe */
  private async updateStripeSubscription(
    stripeSubscriptionId: string,
    opts: {
      price?: string;
      proration_behavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior;
      payment_behavior?: Stripe.SubscriptionUpdateParams.PaymentBehavior;
      cancel_at_period_end?: boolean;
    },
  ) {
    const { price, ...rest } = opts;
    try {
      let items: Stripe.SubscriptionUpdateParams.Item[] | undefined;
      if (price) {
        // O item a trocar é o si_… da assinatura (o sub_… dava "No such
        // subscription item" e a troca de plano sempre falhava)
        const current = await this.stripeService.getSubscription(stripeSubscriptionId);
        const itemId = current.items.data[0]?.id;
        if (!itemId) throw new Error('Assinatura sem item no Stripe');
        items = [{ id: itemId, price }];
      }
      return await this.stripeService.updateSubscription(stripeSubscriptionId, {
        ...(items ? { items } : {}),
        ...rest,
      });
    } catch (error) {
      this.logger.error(`Failed to update Stripe subscription: ${error.message}`);
      throw new BadRequestException(
        'Não foi possível atualizar a assinatura na Stripe (o cartão pode ter sido recusado)',
      );
    }
  }

  /**
   * Plano cobrado por nós: cobra no cartão salvo a diferença proporcional.
   * Mesmo ciclo: (novo − atual) × o que falta do período, vencimento igual.
   * Ciclo diferente (mensal ↔ anual): o plano novo menos o crédito do que
   * falta do atual, e o período recomeça hoje. Devolve o vencimento.
   */
  private async chargeUpgrade(
    sub: {
      id: number;
      userId: number;
      planId: number;
      currentPeriodEnd: Date | null;
      plan: { price: Prisma.Decimal; billingCycle: string };
    },
    newPlan: { id: number; price: Prisma.Decimal; billingCycle: string },
    now: Date,
  ): Promise<Date> {
    const end = must(sub.currentPeriodEnd, 'vencimento do plano');
    const oldPrice = Number(sub.plan.price);
    const newPrice = Number(newPlan.price);
    const left = (cycle: string) =>
      Math.min(1, Math.max(0, end.getTime() - now.getTime()) / cycleMs(cycle));
    let amount: number;
    let periodEnd: Date;
    if (sub.plan.billingCycle === newPlan.billingCycle) {
      amount = (newPrice - oldPrice) * left(newPlan.billingCycle);
      periodEnd = end;
    } else {
      amount = newPrice - oldPrice * left(sub.plan.billingCycle);
      periodEnd = addCycle(now, newPlan.billingCycle);
    }
    amount = roundMoney(Math.max(0, amount));
    if (amount < MIN_STRIPE_CHARGE) return periodEnd;

    const user = await this.prisma.user.findUnique({ where: { id: sub.userId } });
    const paymentMethodId = user?.stripeCustomerId
      ? await this.stripeService.getDefaultPaymentMethodId(user.stripeCustomerId)
      : null;
    if (!user?.stripeCustomerId || !paymentMethodId) {
      throw new BadRequestException('Cadastre um cartão para trocar de plano');
    }
    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await this.stripeService.chargeOffSession({
        amount: Math.round(amount * 100),
        currency: 'brl',
        customerId: user.stripeCustomerId,
        paymentMethodId,
        metadata: {
          kind: 'plan_upgrade',
          subscriptionId: String(sub.id),
          userId: String(sub.userId),
          planId: String(newPlan.id),
        },
        idempotencyKey: `upgrade:${sub.id}:${newPlan.id}:${end.toISOString()}`,
      });
    } catch (error: any) {
      this.logger.warn(`Upgrade do plano recusado (assinatura ${sub.id}): ${error?.message}`);
      throw new BadRequestException(
        'O cartão salvo recusou a diferença do plano. Troque o cartão e tente de novo.',
      );
    }
    if (paymentIntent.status !== 'succeeded') {
      throw new BadRequestException(
        'A cobrança da diferença do plano não foi concluída. Troque o cartão e tente de novo.',
      );
    }
    // Uma vez só, mesmo se a mesma cobrança voltar (mesma chave)
    const recorded = await this.prisma.payment.findFirst({
      where: { transactionId: paymentIntent.id },
    });
    if (!recorded) {
      await this.prisma.payment.create({
        data: {
          subscriptionId: sub.id,
          amount: new Prisma.Decimal(amount),
          paymentDate: now,
          nextPaymentDate: periodEnd,
          paymentMethod: 'stripe',
          transactionId: paymentIntent.id,
          status: PAGAMENTO_STATUS.COMPLETED,
          kind: 'plan_upgrade',
          previousPlanId: sub.planId,
        },
      });
    }
    return periodEnd;
  }

  /**
   * Cancelar o plano: um caminho só (tela e backoffice). O plano pago vale
   * até o fim do período e não renova; aí volta pro gratuito. Antes cortava
   * na hora (dias pagos perdidos), a tela não voltava a conta pra FREE e o
   * backoffice marcava cancelado mesmo se a Stripe recusasse.
   */
  async unsubscribe(userId: number) {
    const lastActiveSub = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
      include: { plan: true },
    });

    if (!lastActiveSub) {
      throw new NotFoundException('You do not have any active subscription');
    }
    if (Number(lastActiveSub.plan.price) <= 0) {
      throw new BadRequestException('O plano gratuito não tem o que cancelar');
    }
    if (lastActiveSub.cancelAtPeriodEnd) return lastActiveSub;

    let endsAt = lastActiveSub.currentPeriodEnd;
    if (lastActiveSub.stripeSubscriptionId) {
      // A Stripe encerra no fim do período e manda customer.subscription.deleted
      const live = await this.updateStripeSubscription(lastActiveSub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      endsAt = new Date(live.current_period_end * 1000);
    }

    const subscription = await this.prisma.subscription.update({
      where: { id: lastActiveSub.id },
      data: {
        cancelAtPeriodEnd: true,
        pendingPlanId: null,
        cancelationDate: endsAt ?? new Date(),
      },
    });
    // Sem vencimento conhecido: não há período a respeitar
    if (!endsAt || endsAt <= new Date()) {
      await this.expireSubscription(lastActiveSub.id, userId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      const context = {
        FullName: user.fullName,
        AppName: 'Barbershop',
        ReactivateURL: appUrl('/pricing'),
        SupportEmail: supportEmail(),
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

  async deletePaymentMethod(userId: number, paymentMethodId: string) {
    this.logger.log(`Deleting payment method: ${paymentMethodId}`);
    // Só o cartão do próprio usuário (antes qualquer login removia o de outro)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    const pm = user?.stripeCustomerId
      ? await this.stripeService.retrievePaymentMethod(paymentMethodId).catch(() => null)
      : null;
    const owner = typeof pm?.customer === 'string' ? pm.customer : pm?.customer?.id;
    if (!pm || !owner || owner !== user?.stripeCustomerId) {
      throw new NotFoundException('Cartão não encontrado');
    }

    const methods = await this.stripeService.listPaymentMethods(user.stripeCustomerId!);
    const renewing = await this.prisma.subscription.findFirst({
      where: {
        userId,
        status: PLANO_STATUS.ACTIVE,
        cancelAtPeriodEnd: false,
        plan: { price: { gt: 0 } },
      },
      select: { id: true },
    });
    if (renewing && methods.data.length <= 1) {
      throw new BadRequestException(
        'Este é o cartão da renovação. Adicione outro antes de apagar.',
      );
    }

    try {
      await this.stripeService.detachPaymentMethod(paymentMethodId);
      return { success: true, message: 'Payment method deleted successfully' };
    } catch (error) {
      this.logger.error('Error deleting payment method:', error);
      throw error;
    }
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

    const activePlan = await this.prisma.subscription.findFirst({
      where: { userId, status: PLANO_STATUS.ACTIVE },
      include: { plan: { select: { price: true } } },
    });
    if (blocksNewCheckout(activePlan)) throw new BadRequestException(CHECKOUT_HAS_PAID_PLAN);

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
      const discountAmount = roundMoney(Math.min(price, validation.discountAmount ?? 0));
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

    if (coupon) {
      // Reserva o uso do cupom para esta cobrança; a cobrança anterior com o
      // mesmo cupom (outra aba, checkout guardado) é cancelada
      let replaced: string[];
      try {
        replaced = await this.couponsService.reserve(coupon.couponId, userId, paymentIntent.id);
      } catch (error) {
        await this.stripeService.cancelPaymentIntent(paymentIntent.id).catch(() => undefined);
        throw error;
      }
      for (const old of replaced) {
        await this.stripeService
          .cancelPaymentIntent(old)
          .catch((e) => this.logger.warn(`Cobrança ${old} com cupom não cancelada: ${e}`));
      }
    }

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      activated: false,
      originalAmount: price,
      discountAmount: coupon?.discountAmount ?? 0,
      finalAmount,
    };
  }

  async confirmPaymentIntent(callerUserId: number, paymentIntentId: string) {
    this.logger.log(`Confirming PaymentIntent: ${paymentIntentId}`);

    // Só o pagamento criado pra quem chama (o userId vai nos metadados)
    const owned = await this.stripeService.retrievePaymentIntent(paymentIntentId).catch(() => null);
    if (!owned || parseInt(owned.metadata?.userId || '0') !== callerUserId) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    try {
      // First, retrieve the PaymentIntent to check its current status
      const existingPaymentIntent = owned;
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

    // Inclui plano já removido do catálogo: o plano vem do pagamento, criado
    // quando ele ainda estava à venda. Sem isso, plano removido entre o
    // pagamento e a confirmação cobrava sem entregar o plano (item 259)
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId },
      withDeleted: true,
    } as Prisma.PlanFindFirstArgs);
    if (!plan) throw new NotFoundException('Plan not found');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const periodEnd = addCycle(now, plan.billingCycle);
    const price = Number(plan.price);

    // A tela e o webhook do Stripe confirmam o mesmo pagamento, às vezes ao
    // mesmo tempo: a trava por pagamento garante uma assinatura só
    let couponRefused = false;
    const result = await this.prisma.$transaction(async (tx) => {
      if (paymentIntentId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${
          'checkout:' + paymentIntentId
        }))`;
        const existing = await tx.payment.findFirst({
          where: { transactionId: paymentIntentId },
          include: { subscription: true },
        });
        if (existing?.subscription) {
          return {
            subscription: existing.subscription,
            created: false,
            cancelStripeIds: [] as string[],
          };
        }
      }

      const blocking = await tx.subscription.findFirst({
        where: { userId, status: PLANO_STATUS.ACTIVE },
        include: { plan: { select: { price: true } } },
      });
      if (blocksNewCheckout(blocking, now)) return { blocked: true as const };

      // Cupom: o uso é registrado aqui, com trava. Sem cobrança (plano
      // grátis pelo cupom), uso que não cabe mais não ativa nada. Cobrança
      // paga sem a reserva do cupom (outra aba, cobrança guardada) é
      // estornada inteira, sem ativar o plano com o desconto
      if (
        coupon &&
        !(await this.couponsService.claimUse(tx, coupon.couponId, userId, paymentIntentId))
      ) {
        if (!paymentIntentId) throw new BadRequestException('Cupom já foi utilizado');
        couponRefused = true;
        return null;
      }

      // A assinatura anterior (ex.: o Free) é encerrada. Se ela cobrava na
      // Stripe, a assinatura de lá também acaba (item 306).
      const ending = await tx.subscription.findMany({
        where: { userId, status: PLANO_STATUS.ACTIVE, stripeSubscriptionId: { not: null } },
        select: { stripeSubscriptionId: true },
      });
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
      // Primeiro plano pago de quem veio por convite: quem convidou ganha agora
      const reward = paymentIntentId ? await rewardInviterOnFirstPayment(tx, userId) : null;
      return {
        subscription,
        created: true,
        reward,
        cancelStripeIds: ending
          .map((row) => row.stripeSubscriptionId)
          .filter((id): id is string => !!id),
      };
    });

    if (result && 'blocked' in result) {
      if (paymentIntentId) {
        this.logger.warn(`Checkout ${paymentIntentId} com plano pago ativo: estorno`);
        await this.stripeService
          .createRefund(
            paymentIntentId,
            undefined,
            'duplicate',
            `checkout-blocked:${paymentIntentId}`,
          )
          .catch((e) => this.logger.error(`Estorno da cobrança ${paymentIntentId} falhou: ${e}`));
      }
      throw new BadRequestException(CHECKOUT_HAS_PAID_PLAN);
    }

    if (!result) {
      if (couponRefused && paymentIntentId) {
        this.logger.warn(
          `Cupom ${coupon?.couponId} sem reserva na cobrança ${paymentIntentId}: estorno`,
        );
        await this.stripeService
          .createRefund(
            paymentIntentId,
            undefined,
            'duplicate',
            `coupon-refused:${paymentIntentId}`,
          )
          .catch((e) => this.logger.error(`Estorno da cobrança ${paymentIntentId} falhou: ${e}`));
      }
      throw new BadRequestException(COUPON_REFUSED_MESSAGE);
    }

    if (result.created && 'reward' in result && result.reward) {
      await this.sendInviterReward(result.reward);
    }
    if (result.created && result.cancelStripeIds.length) {
      for (const stripeSubscriptionId of result.cancelStripeIds) {
        await this.stripeService.cancelSubscription(stripeSubscriptionId).catch((err) => {
          this.logger.warn(
            `Assinatura ${stripeSubscriptionId} não foi cancelada na Stripe após o checkout: ${err}`,
          );
        });
      }
    }
    if (result.created && price > 0) {
      const charged = coupon ? roundMoney(price - coupon.discountAmount) : price;
      await this.sendPlanReceipt(user, charged, periodEnd).catch((e) =>
        this.logger.warn(`E-mail de confirmação do plano não saiu (user ${userId}): ${e}`),
      );
    }
    if (result.created) {
      // O cartão usado vira o padrão: é ele que a renovação cobra
      if (paymentMethodId && user.stripeCustomerId) {
        await this.stripeService
          .setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId)
          .catch((e) => this.logger.warn(`Cartão padrão não definido (user ${userId}): ${e}`));
      }
    }
    return { success: true, subscription: result.subscription };
  }

  /** Recibo do plano pago no checkout (o webhook de fatura cobre o outro caminho). */
  private async sendPlanReceipt(
    user: { id: number; fullName: string; email: string },
    amount: number,
    periodEnd: Date,
  ) {
    await this.emailService.sendTemplateEmail(
      user.id,
      'invoice_email',
      {
        FullName: user.fullName,
        AppName: 'Barbershop',
        InvoiceID: 'plano',
        Amount: amount,
        Currency: 'brl',
        DueDate: periodEnd,
        InvoiceURL: appUrl('/payment-history'),
        SupportEmail: supportEmail(),
        Year: new Date().getFullYear(),
        TimeZone: await timeZoneForOwner(this.prisma, user.id),
      },
      {
        pt: 'Pagamento recebido',
        en: 'Payment received',
        es: 'Pago recibido',
      },
      'invoice',
      user.email,
    );
  }

  /** Três dias antes do vencimento, uma vez: o job diário só pega esse dia. */
  async notifyPlansExpiringSoon(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const [y, m, d] = parts.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d + 3, 3, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const subs = await this.prisma.subscription.findMany({
      where: {
        status: PLANO_STATUS.ACTIVE,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: { gte: start, lt: end },
      },
      include: { user: true, plan: true },
    });
    let sent = 0;
    for (const sub of subs) {
      if (Number(sub.plan.price) <= 0 || !sub.user.email) continue;
      await this.emailService
        .sendTemplateEmail(
          sub.user.id,
          'plan_expiring_email',
          {
            FullName: sub.user.fullName,
            DaysLeft: 3,
            RenewURL: appUrl('/pricing'),
            AppName: 'Barbershop',
          },
          {
            pt: 'Seu plano renova em breve',
            en: 'Your plan renews soon',
            es: 'Tu plan se renueva pronto',
          },
          'plan',
          sub.user.email,
        )
        .catch((e) => this.logger.warn(`Aviso de renovação (user ${sub.userId}): ${e}`));
      sent++;
    }
    return sent;
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
    try {
      await this.notifyPlansExpiringSoon();
    } catch (error) {
      this.logger.error(`Aviso de renovação falhou: ${error}`);
    }
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

  /**
   * Cartão novo salvo pelo dono (SetupIntent confirmado): vira o cartão do
   * plano e, se o plano está em atraso, a cobrança sai na hora — como no
   * Booksy, atualizar o cartão já regulariza, sem esperar a tentativa do dia
   * seguinte. Chamado pela tela e pelo webhook; os dois juntos cobram uma vez
   * só (mesma renewalKey).
   */
  async useSavedCardForPlan(
    setupIntentId: string,
    expectedUserId?: number,
  ): Promise<{ overdue: boolean; outcome: string | null }> {
    const setupIntent = await this.stripeService.retrieveSetupIntent(setupIntentId);
    const customerId =
      typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id;
    const paymentMethodId =
      typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
    const user = customerId
      ? await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId } })
      : null;
    // SetupIntent de cliente final (assinatura de serviço) ou de outra pessoa
    if (!user || (expectedUserId !== undefined && user.id !== expectedUserId)) {
      if (expectedUserId !== undefined) throw new BadRequestException('Cartão não encontrado');
      return { overdue: false, outcome: null };
    }
    if (setupIntent.status !== 'succeeded' || !paymentMethodId) {
      if (expectedUserId !== undefined) {
        throw new BadRequestException('O cartão ainda não foi confirmado');
      }
      return { overdue: false, outcome: null };
    }
    await this.stripeService.setDefaultPaymentMethod(
      must(customerId, 'cliente Stripe'),
      paymentMethodId,
    );

    const overdue = await this.prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: PLANO_STATUS.ACTIVE,
        stripeSubscriptionId: null,
        renewalFailedAt: { not: null },
        currentPeriodEnd: { lte: new Date() },
      },
    });
    if (!overdue) return { overdue: false, outcome: null };
    const outcome = await this.renewSubscription(overdue.id, { ignoreDailyLimit: true });
    return { overdue: true, outcome };
  }

  /** Renova uma assinatura se estiver vencida (nada acontece se não estiver). */
  async renewSubscription(
    subscriptionId: number,
    opts: { ignoreDailyLimit?: boolean } = {},
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

    // Cancelado pelo dono: o período pago acabou, volta pro gratuito
    if (sub.cancelAtPeriodEnd) {
      await this.expireSubscription(sub.id, sub.userId);
      return 'expired';
    }
    // Plano menor agendado: entra agora, e a renovação já cobra o preço dele
    if (sub.pendingPlanId != null) {
      const switched = await this.prisma.subscription.updateMany({
        where: { id: sub.id, pendingPlanId: sub.pendingPlanId },
        data: { planId: sub.pendingPlanId, pendingPlanId: null },
      });
      if (switched.count > 0) {
        // findUniqueOrThrow não passa pelo filtro de apagados: o plano
        // agendado que saiu da lista depois (versão nova, item 351) vale
        sub.plan = await this.prisma.plan.findUniqueOrThrow({ where: { id: sub.pendingPlanId } });
        sub.planId = sub.pendingPlanId;
      }
    }

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

    // Uma tentativa por dia (cartão novo cadastrado tenta na hora)
    if (sub.renewalFailedAt && !opts.ignoreDailyLimit) {
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
      const found = payment.renewalKey
        ? await this.stripeService.findPaymentIntentByRenewalKey(payment.renewalKey)
        : null;
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
  /** E-mail de quem convidou com o cupom do mês grátis (falha não derruba o pagamento) */
  private async sendInviterReward(
    reward: NonNullable<Awaited<ReturnType<typeof rewardInviterOnFirstPayment>>>,
  ) {
    const { invite, couponCode } = reward;
    await this.emailService
      .sendTemplateEmail(
        invite.inviterId,
        'friend_invite_accepted_inviter',
        {
          InviterName: invite.inviter.fullName,
          FriendName: invite.acceptedByUser?.fullName ?? '',
          CouponCode: couponCode,
          AppName: 'Barbershop',
        },
        {
          pt: 'Seu amigo assinou! - 1 mês grátis',
          en: 'Your friend subscribed! - 1 month free',
          es: '¡Tu amigo se suscribió! - 1 mes gratis',
        },
        `Friend invite reward for invite ${invite.id}`,
        invite.inviter.email,
      )
      .catch((e) => this.logger.warn(`E-mail do mês grátis do convite ${invite.id}: ${e}`));
  }

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
      // Primeira renovação paga depois do mês grátis do convite também conta
      return { reward: await rewardInviterOnFirstPayment(tx, payment.subscription.userId) };
    });
    if (!done) return;
    if (done.reward) await this.sendInviterReward(done.reward);

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
          SupportEmail: supportEmail(),
          Year: new Date().getFullYear(),
          TimeZone: await timeZoneForOwner(this.prisma, user.id),
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
          SupportEmail: supportEmail(),
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

  /** Aviso da Stripe que encerra o plano: volta ao gratuito (item 307). */
  async releaseToFreePlan(subscriptionId: number, userId: number) {
    await this.expireSubscription(subscriptionId, userId);
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
  /** ownerUserId: quando vem de um usuário comum, só o pagamento dele */
  async forceRecurringPayment(paymentId: number, ownerUserId?: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { subscription: { select: { userId: true } } },
    });
    if (!payment || (ownerUserId != null && payment.subscription.userId !== ownerUserId)) {
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

    if (!payment || payment.subscription.userId !== userId) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    if (payment.status === PAGAMENTO_STATUS.COMPLETED) {
      throw new BadRequestException('Pagamento já foi realizado');
    }

    // O desconto entra na hora de criar a cobrança (createPaymentIntentForCheckout),
    // com claimUse. Mudar o valor deste pagamento no banco não muda a Stripe,
    // aceita um segundo cupom em cima do desconto e, com valor 0, marca pago
    // sem ativar o plano.
    throw new BadRequestException('O cupom entra no checkout, não num pagamento já criado');
  }

  async getAvailableCoupons(userId: number) {
    return await this.couponsService.getCouponsForUser(userId);
  }

  /**
   * Equipe: cancela no fim do período pago, ou desfaz esse cancelamento
   * antes do vencimento. Com assinatura na Stripe, a Stripe é quem encerra.
   */
  async staffSetCancelAtPeriodEnd(userId: number, cancel: boolean) {
    if (cancel) return this.unsubscribe(userId);
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: PLANO_STATUS.ACTIVE },
    });
    if (!sub) throw new NotFoundException('You do not have any active subscription');
    if (!sub.cancelAtPeriodEnd) return sub;
    return this.changePlan(userId, sub.planId);
  }

  /**
   * Equipe: estorna uma cobrança de plano paga pela Stripe. Se é a cobrança
   * do período atual da assinatura ativa, o plano acaba agora: volta ao
   * gratuito e a assinatura na Stripe é cancelada (não cobra de novo).
   * Dinheiro devolvido não deixa o plano valendo. Cobrança antiga só devolve.
   */
  async staffRefundPlanPayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.status !== PAGAMENTO_STATUS.COMPLETED) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    const intent = [payment.paymentId, payment.transactionId].find((id) => id?.startsWith('pi_'));
    if (!intent) throw new BadRequestException('Essa cobrança não tem pagamento na Stripe');
    await this.stripeService.createRefund(
      intent,
      undefined,
      undefined,
      `plan-refund-${payment.id}`,
    );
    await this.markPlanPaymentRefunded(payment.id);
    return payment.id;
  }

  /**
   * Estorno feito no painel da Stripe (charge.refunded): a cobrança do plano
   * estornada por inteiro tem o mesmo efeito do estorno pela equipe. Parcial
   * não muda o plano.
   */
  async syncPlanRefund(charge: Stripe.Charge) {
    const intent =
      typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    if (!intent || !charge.refunded) return;
    const payment = await this.prisma.payment.findFirst({
      where: {
        status: PAGAMENTO_STATUS.COMPLETED,
        OR: [{ transactionId: intent }, { paymentId: intent }],
      },
      select: { id: true },
    });
    if (payment) await this.markPlanPaymentRefunded(payment.id);
  }

  /** Marca estornada (uma vez só) e encerra o plano se era o período atual. */
  private async markPlanPaymentRefunded(paymentId: number) {
    const claimed = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: PAGAMENTO_STATUS.COMPLETED },
      data: { status: PAGAMENTO_STATUS.REFUNDED },
    });
    if (claimed.count === 0) return;
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { subscription: true },
    });
    const sub = payment.subscription;
    if (sub.status !== PLANO_STATUS.ACTIVE) return;
    // Diferença do plano maior: volta ao plano de antes, o período fica (item 305)
    if (payment.kind === 'plan_upgrade') {
      if (payment.previousPlanId) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { planId: payment.previousPlanId },
        });
      }
      this.logger.log(
        `Assinatura ${sub.id} voltou ao plano anterior pelo estorno da diferença ${paymentId}`,
      );
      return;
    }
    const latest = await this.prisma.payment.findFirst({
      where: {
        subscriptionId: sub.id,
        status: { in: [PAGAMENTO_STATUS.COMPLETED, PAGAMENTO_STATUS.REFUNDED] },
      },
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (latest?.id !== payment.id) return;
    if (sub.stripeSubscriptionId) {
      // Já cancelada na Stripe (pelo painel, por exemplo) não impede encerrar aqui
      await this.stripeService.cancelSubscription(sub.stripeSubscriptionId).catch((err) => {
        this.logger.warn(
          `Assinatura ${sub.stripeSubscriptionId} não foi cancelada na Stripe após o estorno: ${err}`,
        );
      });
    }
    await this.expireSubscription(sub.id, sub.userId);
    this.logger.log(
      `Plano da assinatura ${sub.id} encerrado pelo estorno do pagamento ${paymentId}`,
    );
  }
}
