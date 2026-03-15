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

    // Se há diferença de preço, criar um pagamento pendente para o próximo vencimento
    if (priceDiff !== 0) {
      await this.prisma.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: new Prisma.Decimal(Math.abs(priceDiff)),
          nextPaymentDate: nextPaymentDate,
          paymentDate: nextPaymentDate, // Será cobrado no próximo vencimento
          paymentMethod: 'stripe',
          transactionId: null, // Será preenchido quando o pagamento for processado
          status: priceDiff > 0 ? PAGAMENTO_STATUS.PENDING : PAGAMENTO_STATUS.COMPLETED, // Se downgrade, marca como pago
        },
      });

      this.logger.log(
        `Plan change for user ${userId}: ${subscription.plan.name} -> ${newPlan.name}. Price difference: ${priceDiff}. Will be charged on ${nextPaymentDate}`,
      );
    }

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
        AppName: 'Relable',
        ReactivateURL: 'https://app.relable.com/plans',
        SupportEmail: 'suporte@relable.com.br',
        Year: new Date().getFullYear(),
      };

      try {
        await this.emailService.sendTemplateEmail(
          user.id,
          'plan_canceled_email',
          context,
          'Plan canceled',
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

  async createPaymentIntentForCheckout(userId: number, planId: number) {
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

    const amountInCents = Math.floor(Number(plan.price) * 100 + 0.5);
    const paymentIntent = await this.stripeService.createPaymentIntent(
      amountInCents,
      'brl',
      customer.id,
    );

    await this.stripeService.updatePaymentIntent(paymentIntent.id, {
      metadata: {
        userId: userId.toString(),
        planId: plan.id.toString(),
        planName: plan.name,
      },
    });

    return {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
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
        this.logger.log(`PaymentIntent ${paymentIntentId} is already succeeded, skipping confirmation`);
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
          return await this.createSubscriptionAfterPayment(userId, planId, paymentIntent.id);
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
              return await this.createSubscriptionAfterPayment(userId, planId, paymentIntent.id);
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
    paymentIntentId: string,
  ) {
    this.logger.log(`Creating subscription after payment - User: ${userId}, Plan: ${planId}`);

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

    // Verificar se já existe uma assinatura ativa
    const lastActiveSub = await this.prisma.subscription.findFirst({
      where: { userId, AND: { status: PLANO_STATUS.ACTIVE } },
    });

    if (lastActiveSub) {
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
    }

    // Criar nova assinatura
    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        planId,
        startSubDate: new Date(),
        status: PLANO_STATUS.ACTIVE,
        stripeCustomerId: user.stripeCustomerId,
      } as any,
    });

    // Criar registro de pagamento
    await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(plan.price),
        nextPaymentDate:
          plan.billingCycle === 'YEARLY' ? addYears(new Date(), 1) : addDays(new Date(), 30),
        paymentDate: new Date(),
        paymentMethod: 'stripe',
        transactionId: paymentIntentId,
        status: PAGAMENTO_STATUS.COMPLETED,
      },
    });

    return { success: true, subscription };
  }

  /**
   * Processa cobranças automáticas para pagamentos vencidos
   * Este método é chamado por um cron job
   */
  async processRecurringPayments() {
    this.logger.log('Iniciando processamento de cobranças recorrentes...');

    try {
      // Buscar pagamentos vencidos (incluindo pendentes de mudança de plano)
      const overduePayments = await this.prisma.payment.findMany({
        where: {
          nextPaymentDate: {
            lte: new Date(), // Pagamentos vencidos
          },
          status: {
            in: [PAGAMENTO_STATUS.COMPLETED, PAGAMENTO_STATUS.PENDING], // Incluir pagamentos pendentes
          },
        },
        include: {
          subscription: {
            include: {
              user: true,
              plan: true,
            },
          },
        },
      });

      this.logger.log(`Encontrados ${overduePayments.length} pagamentos vencidos para processar`);

      for (const payment of overduePayments) {
        try {
          await this.processRecurringPayment(payment);
        } catch (error) {
          this.logger.error(
            `Erro ao processar cobrança recorrente para pagamento ${payment.id}:`,
            error,
          );
        }
      }

      this.logger.log('Processamento de cobranças recorrentes concluído');
    } catch (error) {
      this.logger.error('Erro durante o processamento de cobranças recorrentes:', error);
    }
  }

  /**
   * Processa uma cobrança recorrente específica
   */
  private async processRecurringPayment(payment: any) {
    const { subscription } = payment;
    const { user, plan } = subscription;

    this.logger.log(
      `Processando cobrança recorrente para usuário ${user.id} (${user.email}) - Plano: ${plan.name}`,
    );

    // Verificar se o usuário tem um customer ID do Stripe
    if (!user.stripeCustomerId) {
      this.logger.warn(`Usuário ${user.id} não possui stripeCustomerId`);
      await this.handlePaymentFailure(
        payment,
        'Usuário não possui método de pagamento configurado',
      );
      return;
    }

    // Verificar se a assinatura ainda está ativa
    if (subscription.status !== PLANO_STATUS.ACTIVE) {
      this.logger.warn(
        `Assinatura ${subscription.id} não está ativa (status: ${subscription.status})`,
      );
      return;
    }

    try {
      // Determinar o valor a ser cobrado
      let amountToCharge = Number(plan.price);

      // Se for um pagamento pendente (mudança de plano), usar o valor do pagamento
      if (payment.status === PAGAMENTO_STATUS.PENDING) {
        amountToCharge = Number(payment.amount);
        this.logger.log(`Processando pagamento pendente de mudança de plano: R$ ${amountToCharge}`);
      }

      // Tentar cobrar automaticamente via Stripe
      const paymentIntent = await this.stripeService.createPaymentIntent(
        Math.round(amountToCharge * 100), // Converter para centavos
        'brl',
        user.stripeCustomerId,
      );

      // Confirmar o pagamento automaticamente
      const confirmedPayment = await this.stripeService.confirmPaymentIntent(paymentIntent.id);

      if (confirmedPayment.status === 'succeeded') {
        await this.handleSuccessfulRecurringPayment(payment, confirmedPayment, amountToCharge);
      } else {
        await this.handlePaymentFailure(
          payment,
          `Pagamento falhou com status: ${confirmedPayment.status}`,
        );
      }
    } catch (error) {
      this.logger.error(`Erro ao processar cobrança para usuário ${user.id}:`, error);
      await this.handlePaymentFailure(payment, error.message);
    }
  }

  /**
   * Processa um pagamento recorrente bem-sucedido
   */
  private async handleSuccessfulRecurringPayment(
    payment: any,
    stripePayment: any,
    amountCharged?: number,
  ) {
    const { subscription } = payment;
    const { user, plan } = subscription;

    // Calcular próxima data de pagamento
    const nextPaymentDate =
      plan.billingCycle === 'YEARLY' ? addYears(new Date(), 1) : addDays(new Date(), 30);

    // Usar o valor cobrado ou o valor do plano
    const paymentAmount = amountCharged || Number(plan.price);

    // Criar novo registro de pagamento
    const newPayment = await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(paymentAmount),
        paymentDate: new Date(),
        nextPaymentDate,
        paymentMethod: 'stripe',
        transactionId: stripePayment.id,
        status: PAGAMENTO_STATUS.COMPLETED,
      },
    });

    // Atualizar status do usuário
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        membership: MEMBERSHIP_STATUS.PAID,
        isActive: true,
      },
    });

    // Enviar email de confirmação
    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      InvoiceID: stripePayment.id,
      Amount: paymentAmount.toFixed(2),
      DueDate: new Date(nextPaymentDate).toLocaleDateString('pt-BR'),
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    try {
      await this.emailService.sendTemplateEmail(
        user.id,
        'recurring_payment_success',
        context,
        `Pagamento recorrente processado - ${plan.name}`,
        'recurring_payment',
        user.email,
      );
    } catch (error) {
      this.logger.error(`Falha ao enviar email de confirmação para ${user.email}`, error);
    }

    this.logger.log(
      `Pagamento recorrente processado com sucesso para usuário ${user.id} - Pagamento ID: ${newPayment.id}`,
    );
  }

  /**
   * Processa falha em pagamento recorrente
   */
  private async handlePaymentFailure(payment: any, reason: string) {
    const { subscription } = payment;
    const { user, plan } = subscription;

    // Atualizar status do usuário para pagamento em atraso
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        membership: MEMBERSHIP_STATUS.PAST_DUE,
        isActive: false,
      },
    });

    // Atualizar status da assinatura
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: PLANO_STATUS.INACTIVE,
      },
    });

    // Enviar email de notificação de falha
    const context = {
      FullName: user.fullName,
      AppName: 'Relable',
      PlanName: plan.name,
      Amount: plan.price.toFixed(2),
      Reason: reason,
      SupportEmail: 'suporte@relable.com.br',
      Year: new Date().getFullYear(),
    };

    try {
      await this.emailService.sendTemplateEmail(
        user.id,
        'recurring_payment_failed',
        context,
        `Falha no pagamento recorrente - ${plan.name}`,
        'payment_failed',
        user.email,
      );
    } catch (error) {
      this.logger.error(`Falha ao enviar email de notificação para ${user.email}`, error);
    }

    this.logger.warn(`Falha no pagamento recorrente para usuário ${user.id} - Motivo: ${reason}`);
  }

  /**
   * Busca pagamentos vencidos para relatórios
   */
  async getOverduePayments() {
    return this.prisma.payment.findMany({
      where: {
        nextPaymentDate: {
          lte: new Date(),
        },
        status: PAGAMENTO_STATUS.COMPLETED,
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
  }

  /**
   * Força o processamento de um pagamento recorrente específico
   */
  async forceRecurringPayment(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        subscription: {
          include: {
            user: true,
            plan: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Pagamento não encontrado');
    }

    await this.processRecurringPayment(payment);
    return { success: true, message: 'Pagamento recorrente processado' };
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
