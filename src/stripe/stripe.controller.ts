import { Controller, Post, Headers, Req, HttpCode, Logger, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { EmailService } from '../email/email.service';
import { MEMBERSHIP_STATUS, PLANO_STATUS, PAGAMENTO_STATUS } from '@/common';
import { Role } from '@/auth/interfaces/roles';
import { StripeService } from './stripe.service';
import { Request } from 'express';

@ApiTags('stripe')
@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private stripeService: StripeService,
  ) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook handler' })
  @ApiResponse({ status: 200 })
  @HttpCode(200)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: Request,
  ) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        this.logger.error('Raw body not available for webhook verification');
        return { received: false };
      }
      const payload = rawBody.toString('utf8');
      event = await this.stripeService.handleWebhookEvent(payload, signature, webhookSecret);
    } catch (err) {
      this.logger.error('Invalid stripe webhook signature', err);
      return { received: false };
    }

    this.logger.log(`Processing webhook event: ${event.type}`);

    try {
      switch (event.type) {
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(`Error processing webhook event ${event.type}:`, error);
    }

    return { received: true };
  }

  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    const subscriptionId = (invoice.subscription as string) || '';

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true, plan: true },
    });

    if (!subscription) {
      this.logger.warn(`Subscription not found for Stripe subscription ID: ${subscriptionId}`);
      return;
    }

    const memberRole = await this.prisma.role.findFirst({
      where: { name: Role.BARBERSHOP_OWNER },
    });

    // Atualizar status do usuário
    await this.prisma.user.update({
      where: { id: subscription.userId },
      data: {
        membership: MEMBERSHIP_STATUS.PAID,
        isActive: true,
        role: memberRole ? { connect: { id: memberRole.id } } : undefined,
      },
    });

    // Atualizar status da assinatura
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: PLANO_STATUS.ACTIVE,
      },
    });

    // Criar registro de pagamento
    const payment = await this.prisma.payment.create({
      data: {
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(invoice.amount_paid / 100),
        paymentDate: new Date(invoice.created * 1000),
        nextPaymentDate: new Date((invoice.next_payment_attempt || invoice.created) * 1000),
        paymentMethod: 'stripe',
        transactionId: invoice.payment_intent as string,
        status: PAGAMENTO_STATUS.COMPLETED,
      },
    });

    // Enviar email de confirmação
    const context = {
      FullName: subscription.user.fullName,
      AppName: 'Barbershop',
      InvoiceID: invoice.id,
      Amount: (invoice.amount_paid / 100).toFixed(2),
      DueDate: new Date(payment.nextPaymentDate).toLocaleDateString('pt-BR'),
      InvoiceURL: invoice.hosted_invoice_url,
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    try {
      await this.emailService.sendTemplateEmail(
        subscription.user.id,
        'invoice_email',
        context,
        `Pagamento recebido - Fatura ${invoice.id}`,
        'invoice',
        subscription.user.email,
      );
    } catch (error) {
      this.logger.error(`Failed to send invoice email to ${subscription.user.email}`, error);
    }
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId = (invoice.subscription as string) || '';

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true },
    });

    if (!subscription) {
      return;
    }

    // Atualizar status do usuário para pagamento em atraso
    await this.prisma.user.update({
      where: { id: subscription.userId },
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

    this.logger.log(
      `Payment failed for user ${subscription.userId}, subscription ${subscriptionId}`,
    );
  }

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    this.logger.log(`Subscription created: ${subscription.id}`);
  }

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      include: { user: true },
    });

    if (!dbSubscription) {
      return;
    }

    // Atualizar status baseado no status do Stripe
    let membershipStatus = MEMBERSHIP_STATUS.FREE;
    let isActive = false;
    let planStatus = PLANO_STATUS.INACTIVE;

    switch (subscription.status) {
      case 'active':
        membershipStatus = MEMBERSHIP_STATUS.PAID;
        isActive = true;
        planStatus = PLANO_STATUS.ACTIVE;
        break;
      case 'past_due':
        membershipStatus = MEMBERSHIP_STATUS.PAST_DUE;
        isActive = false;
        planStatus = PLANO_STATUS.INACTIVE;
        break;
      case 'canceled':
        membershipStatus = MEMBERSHIP_STATUS.FREE;
        isActive = false;
        planStatus = PLANO_STATUS.INACTIVE;
        break;
      case 'unpaid':
        membershipStatus = MEMBERSHIP_STATUS.PAST_DUE;
        isActive = false;
        planStatus = PLANO_STATUS.INACTIVE;
        break;
    }

    await this.prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        membership: membershipStatus,
        isActive,
      },
    });

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: planStatus,
      },
    });
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const dbSubscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscription.id },
      include: { user: true },
    });

    if (!dbSubscription) {
      return;
    }

    // Atualizar status do usuário para FREE
    await this.prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        membership: MEMBERSHIP_STATUS.FREE,
        isActive: false,
      },
    });

    // Atualizar status da assinatura
    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: {
        status: PLANO_STATUS.INACTIVE,
        cancelationDate: new Date(),
      },
    });

    this.logger.log(`Subscription deleted for user ${dbSubscription.userId}`);
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment intent succeeded: ${paymentIntent.id}`);
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment intent failed: ${paymentIntent.id}`);
  }

  @Get('health')
  @ApiOperation({ summary: 'Check Stripe health' })
  @ApiResponse({ status: 200 })
  async checkHealth() {
    const isAvailable = await this.stripeService.isAvailable();
    return {
      available: isAvailable,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('customer/:customerId')
  @ApiOperation({ summary: 'Get Stripe customer info' })
  @ApiResponse({ status: 200 })
  async getCustomer(@Param('customerId') customerId: string) {
    try {
      const customer = await this.stripeService.getCustomer(customerId);
      return customer;
    } catch (error) {
      this.logger.error(`Failed to get customer ${customerId}:`, error);
      throw error;
    }
  }

  @Get('test')
  @ApiOperation({ summary: 'Test Stripe connection' })
  @ApiResponse({ status: 200 })
  async testStripe() {
    try {
      const isAvailable = await this.stripeService.isAvailable();
      return {
        success: true,
        available: isAvailable,
        message: isAvailable ? 'Stripe is working correctly' : 'Stripe is not available',
      };
    } catch (error) {
      this.logger.error('Stripe test failed:', error);
      return {
        success: false,
        available: false,
        message: 'Stripe test failed',
        error: error.message,
      };
    }
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get Stripe prices for plans' })
  @ApiResponse({ status: 200 })
  async getStripePlans() {
    try {
      const plans = await this.prisma.plan.findMany({
        select: {
          id: true,
          name: true,
          price: true,
          billingCycle: true,
          stripePriceId: true,
        },
      });

      return {
        success: true,
        plans: plans.map((plan) => ({
          ...plan,
          hasStripePrice: !!plan.stripePriceId,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get plans:', error);
      return {
        success: false,
        message: 'Failed to get plans',
        error: error.message,
      };
    }
  }
}
