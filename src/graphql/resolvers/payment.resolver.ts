import { Resolver, Query, Mutation, Context, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import {
  Payment,
  PaymentMethod,
  SetupIntent,
  PaymentIntentResponse,
  ConfirmPaymentIntentResponse,
  DeletePaymentMethodResponse,
} from '../types/payment.type';
import { Subscription } from '../types/plan.type';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from '../../stripe/stripe.service';
import { PaymentsService } from '../../payments/payments.service';
import { Logger } from '@nestjs/common';
import {
  UserRecurringPaymentsStats,
  ProcessRecurringPaymentResponse,
  ProcessAllRecurringPaymentsResponse,
} from '../types/recurring-payments.type';

@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
export class PaymentResolver {
  private readonly logger = new Logger(PaymentResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Query(() => [Payment])
  async myPayments(@Context() context: any): Promise<Payment[]> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching payments for user ${userId}`);

    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          subscription: {
            userId: userId,
          },
        },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
      });

      this.logger.log(`Found ${payments.length} payments for user ${userId}`);
      return payments.map((payment) => ({
        id: payment.id,
        subscriptionId: payment.subscriptionId,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate.toISOString(),
        nextPaymentDate: payment.nextPaymentDate.toISOString(),
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      }));
    } catch (error) {
      this.logger.error(`Error fetching payments for user ${userId}:`, error);
      throw new Error('Failed to fetch payments');
    }
  }

  @Query(() => [Subscription])
  async mySubscriptions(@Context() context: any): Promise<Subscription[]> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching subscriptions for user ${userId}`);

    try {
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          userId: userId,
        },
        include: {
          plan: true,
          payments: {
            orderBy: {
              paymentDate: 'desc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      this.logger.log(`Found ${subscriptions.length} subscriptions for user ${userId}`);
      return subscriptions.map((subscription) => ({
        ...subscription,
        startSubDate: subscription.startSubDate.toISOString(),
        cancelationDate: subscription.cancelationDate?.toISOString(),
        createdAt: subscription.createdAt.toISOString(),
        updatedAt: subscription.updatedAt.toISOString(),
        plan: {
          ...subscription.plan,
          price: Number(subscription.plan.price),
          createdAt: subscription.plan.createdAt?.toISOString() || new Date().toISOString(),
          updatedAt: subscription.plan.updatedAt?.toISOString() || new Date().toISOString(),
          deleted_at: subscription.plan.deleted_at?.toISOString() || null,
        },
        payments: subscription.payments.map((payment) => ({
          id: payment.id,
          subscriptionId: payment.subscriptionId,
          amount: Number(payment.amount),
          paymentDate: payment.paymentDate.toISOString(),
          nextPaymentDate: payment.nextPaymentDate.toISOString(),
          paymentMethod: payment.paymentMethod,
          transactionId: payment.transactionId,
          status: payment.status,
          createdAt: payment.createdAt.toISOString(),
          updatedAt: payment.updatedAt.toISOString(),
        })),
      }));
    } catch (error) {
      this.logger.error(`Error fetching subscriptions for user ${userId}:`, error);
      throw new Error('Failed to fetch subscriptions');
    }
  }

  @Query(() => [PaymentMethod])
  async myPaymentMethods(@Context() context: any): Promise<PaymentMethod[]> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching payment methods for user ${userId}`);

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true },
      });

      if (!user?.stripeCustomerId) {
        this.logger.log(`User ${userId} has no stripeCustomerId`);
        return [];
      }

      const paymentMethodsResponse = await this.stripeService.listPaymentMethods(
        user.stripeCustomerId,
      );
      const paymentMethods = paymentMethodsResponse.data;

      this.logger.log(`Found ${paymentMethods.length} payment methods for user ${userId}`);
      return paymentMethods.map((pm) => ({
        id: pm.id,
        type: pm.type,
        card: pm.card
          ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              expMonth: pm.card.exp_month,
              expYear: pm.card.exp_year,
            }
          : undefined,
      }));
    } catch (error) {
      this.logger.error(`Error fetching payment methods for user ${userId}:`, error);
      throw new Error('Failed to fetch payment methods');
    }
  }

  @Query(() => Payment, { nullable: true })
  async latestPendingPayment(@Context() context: any): Promise<Payment | null> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching latest pending payment for user ${userId}`);

    try {
      const payment = await this.prisma.payment.findFirst({
        where: {
          subscription: {
            userId: userId,
          },
          status: {
            in: ['PENDING', 'OPEN'],
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
      });

      this.logger.log(
        `Latest pending payment for user ${userId}: ${payment ? payment.id : 'none'}`,
      );
      if (!payment) return null;

      return {
        id: payment.id,
        subscriptionId: payment.subscriptionId,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate.toISOString(),
        nextPaymentDate: payment.nextPaymentDate.toISOString(),
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error fetching latest pending payment for user ${userId}:`, error);
      throw new Error('Failed to fetch latest pending payment');
    }
  }

  @Mutation(() => SetupIntent)
  async createSetupIntent(@Context() context: any): Promise<SetupIntent> {
    const userId = context.req.user.id;
    this.logger.log(`Creating setup intent for user ${userId}`);

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          stripeCustomerId: true,
          email: true,
          fullName: true,
        },
      });

      if (!user) {
        throw new Error('User not found');
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

      const setupIntent = await this.stripeService.createSetupIntent(stripeCustomerId);

      this.logger.log(`Created setup intent ${setupIntent.id} for user ${userId} with client_secret: ${setupIntent.client_secret?.substring(0, 30)}...`);
      this.logger.log(`SetupIntent details: ${JSON.stringify({
        id: setupIntent.id,
        status: setupIntent.status,
        customer: setupIntent.customer,
        usage: setupIntent.usage,
        payment_method_types: setupIntent.payment_method_types
      }, null, 2)}`);
      return setupIntent;
    } catch (error) {
      this.logger.error(`Error creating setup intent for user ${userId}:`, error);
      throw new Error(`Failed to create setup intent: ${error.message}`);
    }
  }

  @Mutation(() => PaymentIntentResponse)
  async createPaymentIntent(
    @Args('planId', { type: () => Int }) planId: number,
    @Context() context: any,
  ): Promise<PaymentIntentResponse> {
    const userId = context.req.user?.id;
    this.logger.log(`Creating payment intent for user ${userId}, plan ${planId}`);

    if (!userId) {
      throw new Error('User not authenticated');
    }

    if (!planId || planId <= 0) {
      throw new Error('Invalid plan ID');
    }

    try {
      const result = await this.paymentsService.createPaymentIntentForCheckout(userId, planId);

      return {
        clientSecret: result.clientSecret,
        paymentIntentId: result.paymentIntentId,
      };
    } catch (error) {
      this.logger.error(`Error creating payment intent for user ${userId}:`, error);
      throw new Error(error.message || 'Failed to create payment intent');
    }
  }

  @Mutation(() => ConfirmPaymentIntentResponse)
  async confirmPaymentIntent(
    @Args('paymentIntentId', { type: () => String }) paymentIntentId: string,
    @Context() context: any,
  ): Promise<ConfirmPaymentIntentResponse> {
    const userId = context.req.user?.id;
    this.logger.log(`Confirming payment intent for user ${userId}`);

    if (!userId) {
      throw new Error('User not authenticated');
    }

    if (!paymentIntentId || paymentIntentId.trim() === '') {
      throw new Error('PaymentIntent ID is required and cannot be empty');
    }

    try {
      const result = await this.paymentsService.confirmPaymentIntent(paymentIntentId);

      if ('subscription' in result && result.subscription) {
        const subscriptionWithPlan = await this.prisma.subscription.findUnique({
          where: { id: result.subscription.id },
          include: { plan: true },
        });

        if (subscriptionWithPlan) {
          return {
            success: result.success,
            subscription: {
              id: subscriptionWithPlan.id,
              status: subscriptionWithPlan.status,
              plan: {
                id: subscriptionWithPlan.plan.id,
                name: subscriptionWithPlan.plan.name,
                price: Number(subscriptionWithPlan.plan.price),
              },
            },
          };
        }
      }

      return {
        success: result.success,
        subscription: null,
      };
    } catch (error) {
      this.logger.error(`Error confirming payment intent for user ${userId}:`, error);
      throw new Error(error.message || 'Failed to confirm payment intent');
    }
  }

  @Mutation(() => DeletePaymentMethodResponse)
  async deletePaymentMethod(
    @Args('paymentMethodId', { type: () => String }) paymentMethodId: string,
    @Context() context: any,
  ): Promise<DeletePaymentMethodResponse> {
    const userId = context.req.user.id;
    this.logger.log(`Deleting payment method ${paymentMethodId} for user ${userId}`);

    try {
      const result = await this.paymentsService.deletePaymentMethod(paymentMethodId);

      this.logger.log(`Deleted payment method for user ${userId}`);
      return {
        success: result.success,
        message: result.message,
      };
    } catch (error) {
      this.logger.error(`Error deleting payment method for user ${userId}:`, error);
      throw new Error(error.message || 'Failed to delete payment method');
    }
  }

  @Query(() => [Payment])
  async overduePayments(@Context() context: any): Promise<Payment[]> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching overdue payments for user ${userId}`);

    try {
      const payments = await this.prisma.payment.findMany({
        where: {
          subscription: {
            userId: userId,
          },
          nextPaymentDate: {
            lte: new Date(),
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
        orderBy: {
          nextPaymentDate: 'asc',
        },
      });

      this.logger.log(`Found ${payments.length} overdue payments for user ${userId}`);
      return payments.map((payment) => ({
        id: payment.id,
        subscriptionId: payment.subscriptionId,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate.toISOString(),
        nextPaymentDate: payment.nextPaymentDate.toISOString(),
        paymentMethod: payment.paymentMethod,
        transactionId: payment.transactionId,
        status: payment.status,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
        daysOverdue: Math.floor(
          (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      }));
    } catch (error) {
      this.logger.error(`Error fetching overdue payments for user ${userId}:`, error);
      throw new Error('Failed to fetch overdue payments');
    }
  }

  @Query(() => UserRecurringPaymentsStats)
  async recurringPaymentsStats(@Context() context: any): Promise<UserRecurringPaymentsStats> {
    const userId = context.req.user.id;
    this.logger.log(`Fetching recurring payments stats for user ${userId}`);

    try {
      const overduePayments = await this.prisma.payment.findMany({
        where: {
          subscription: {
            userId: userId,
          },
          nextPaymentDate: {
            lte: new Date(),
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });

      const upcomingPayments = await this.prisma.payment.findMany({
        where: {
          subscription: {
            userId: userId,
          },
          nextPaymentDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Próximos 7 dias
          },
          status: 'COMPLETED',
        },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });

      return {
        overdueCount: overduePayments.length,
        upcomingCount: upcomingPayments.length,
        lastCheck: new Date().toISOString(),
        timezone: 'America/Sao_Paulo',
        nextScheduledRun: '09:00 AM (diário)',
        overduePayments: overduePayments.map((payment) => ({
          id: payment.id,
          planName: payment.subscription.plan.name,
          amount: Number(payment.amount),
          nextPaymentDate: payment.nextPaymentDate.toISOString(),
          daysOverdue: Math.floor(
            (new Date().getTime() - new Date(payment.nextPaymentDate).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        })),
        upcomingPayments: upcomingPayments.map((payment) => ({
          id: payment.id,
          planName: payment.subscription.plan.name,
          amount: Number(payment.amount),
          nextPaymentDate: payment.nextPaymentDate.toISOString(),
          daysUntilPayment: Math.floor(
            (new Date(payment.nextPaymentDate).getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        })),
      };
    } catch (error) {
      this.logger.error(`Error fetching recurring payments stats for user ${userId}:`, error);
      throw new Error('Failed to fetch recurring payments stats');
    }
  }

  @Mutation(() => ProcessRecurringPaymentResponse)
  async processRecurringPayment(
    @Args('paymentId', { type: () => Int }) paymentId: number,
    @Context() context: any,
  ): Promise<ProcessRecurringPaymentResponse> {
    const userId = context.req.user.id;
    this.logger.log(`Processing recurring payment ${paymentId} for user ${userId}`);

    try {
      const result = await this.paymentsService.forceRecurringPayment(paymentId);
      return {
        success: result.success,
        message: result.message,
        processedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Error processing recurring payment ${paymentId} for user ${userId}:`,
        error,
      );
      return {
        success: false,
        message: error.message,
        processedAt: new Date().toISOString(),
      };
    }
  }

  @Mutation(() => ProcessAllRecurringPaymentsResponse)
  async processAllRecurringPayments(
    @Context() context: any,
  ): Promise<ProcessAllRecurringPaymentsResponse> {
    const userId = context.req.user.id;
    this.logger.log(`Processing all recurring payments for user ${userId}`);

    try {
      await this.paymentsService.processRecurringPayments();
      return {
        success: true,
        message: 'Todos os pagamentos recorrentes foram processados',
        processedAt: new Date().toISOString(),
        processedCount: 0, // Será calculado pelo serviço
      };
    } catch (error) {
      this.logger.error(`Error processing all recurring payments for user ${userId}:`, error);
      return {
        success: false,
        message: error.message,
        processedAt: new Date().toISOString(),
        processedCount: 0,
      };
    }
  }
}
