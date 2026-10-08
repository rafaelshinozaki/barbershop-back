import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  Logger,
  Get,
  InternalServerErrorException,
} from '@nestjs/common';
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
import { PaymentsService } from '../payments/payments.service';
import { ChairRentService } from '../barbershop/chair-rent.service';
import { DepositPaymentService } from '../barbershop/deposit-payment.service';
import { IdentityVerificationService } from '../barbershop/identity-verification.service';
import { ConnectService } from '../barbershop/connect.service';
import { TipService } from '../barbershop/tip.service';
import { PrepaymentService } from '../barbershop/prepayment.service';
import { FeaturedPaymentService } from '../barbershop/featured-payment.service';
import { JobOpeningService } from '../barbershop/job-opening.service';
import { AppPaymentsService } from '../barbershop/app-payments.service';
import { currentPricing } from '../pricing/pricing';

@ApiTags('stripe')
@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private stripeService: StripeService,
    private paymentsService: PaymentsService,
    private chairRent: ChairRentService,
    private deposits: DepositPaymentService,
    private identity: IdentityVerificationService,
    private connect: ConnectService,
    private tips: TipService,
    private prepayments: PrepaymentService,
    private featured: FeaturedPaymentService,
    private jobs: JobOpeningService,
    private appPayments: AppPaymentsService,
  ) {}

  @Post('webhook')
  @ApiOperation({ summary: 'Stripe webhook handler' })
  @ApiResponse({ status: 200 })
  @HttpCode(200)
  async handleWebhook(@Headers('stripe-signature') signature: string, @Req() req: Request) {
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    // Eventos das contas conectadas (Connect) chegam num endpoint próprio,
    // com outro segredo; o mesmo handler aceita os dois
    const connectSecret = this.configService.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      const rawBody = (req as any).rawBody as Buffer;
      if (!rawBody) {
        this.logger.error('Raw body not available for webhook verification');
        return { received: false };
      }
      const payload = rawBody.toString('utf8');
      try {
        event = await this.stripeService.handleWebhookEvent(payload, signature, webhookSecret);
      } catch (err) {
        if (!connectSecret) throw err;
        event = await this.stripeService.handleWebhookEvent(payload, signature, connectSecret);
      }
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
        case 'setup_intent.succeeded':
          // Cartão novo do dono: plano em atraso é cobrado na hora
          await this.paymentsService.useSavedCardForPlan(
            (event.data.object as Stripe.SetupIntent).id,
          );
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        // Verificação de identidade do profissional (Stripe Identity)
        case 'identity.verification_session.processing':
        case 'identity.verification_session.requires_input':
        case 'identity.verification_session.verified':
        case 'identity.verification_session.canceled':
          await this.identity.handleStripeSession(
            (event.data.object as Stripe.Identity.VerificationSession).id,
          );
          break;
        // Disputa (chargeback) de pagamento pelo app: o Financeiro acompanha no backoffice
        case 'charge.dispute.created':
        case 'charge.dispute.updated':
        case 'charge.dispute.closed':
          await this.appPayments.recordDispute(event.data.object as Stripe.Dispute);
          break;
        // Estorno pelo painel da Stripe (ou que ficou pendente e depois confirmou)
        case 'charge.refunded':
          await this.appPayments.syncStripeRefund(event.data.object as Stripe.Charge);
          break;
        case 'refund.updated': {
          const refund = event.data.object as Stripe.Refund;
          if (refund.status !== 'succeeded') break;
          const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
          if (!chargeId) break;
          const charge = await this.stripeService.retrieveCharge(chargeId);
          await this.appPayments.syncStripeRefund(charge);
          break;
        }
        // Conta de recebimento (Connect): cadastro concluído, pendência, bloqueio
        case 'account.updated': {
          const account = event.data.object as Stripe.Account;
          await this.connect.apply(account, account.id);
          break;
        }
        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      // Erro ao processar: responde erro pro Stripe reenviar o evento (antes
      // respondia "ok" e o evento se perdia — ex.: pagamento confirmado que
      // não ativava a assinatura). Os handlers são seguros pra repetição.
      this.logger.error(`Error processing webhook event ${event.type}:`, error);
      throw new InternalServerErrorException('Webhook processing failed');
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
      // Aluguel da cadeira (espaço compartilhado) ou assinatura do cliente
      if (await this.chairRent.handleInvoice(invoice, true)) return;
      await this.handleClientSubscriptionInvoiceSucceeded(invoice, subscriptionId);
      return;
    }

    // Evento atrasado ou repetido (o Stripe tenta de novo por dias) não
    // reativa assinatura que já foi cancelada: vale o estado de agora no Stripe
    const live = await this.stripeService.getSubscription(subscriptionId).catch(() => null);
    if (!live || live.status === 'active') {
      const memberRole = await this.prisma.role.findFirst({
        where: { name: Role.BARBERSHOP_OWNER },
      });

      // Plano pago; a conta suspensa pela equipe (isActive) continua como está
      await this.prisma.user.update({
        where: { id: subscription.userId },
        data: {
          membership: MEMBERSHIP_STATUS.PAID,
          role: memberRole ? { connect: { id: memberRole.id } } : undefined,
        },
      });

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: PLANO_STATUS.ACTIVE,
        },
      });
    }

    // Registro do pagamento — uma vez só por fatura: o Stripe pode entregar
    // o mesmo evento mais de uma vez (antes duplicava pagamento e e-mail)
    const transactionId = (invoice.payment_intent as string) || invoice.id;
    const payment = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + transactionId}))`;
      const existing = await tx.payment.findFirst({ where: { transactionId } });
      if (existing) return null;
      return tx.payment.create({
        data: {
          subscriptionId: subscription.id,
          amount: new Prisma.Decimal(invoice.amount_paid / 100),
          paymentDate: new Date(invoice.created * 1000),
          nextPaymentDate: new Date((invoice.next_payment_attempt || invoice.created) * 1000),
          paymentMethod: 'stripe',
          transactionId,
          status: PAGAMENTO_STATUS.COMPLETED,
        },
      });
    });
    if (!payment) {
      this.logger.log(`Invoice ${invoice.id} already recorded — duplicate event ignored`);
      return;
    }

    // Enviar email de confirmação
    const context = {
      FullName: subscription.user.fullName,
      AppName: 'Barbershop',
      InvoiceID: invoice.id,
      // Formatados no template ({{money}}/{{date}}) no idioma do usuário
      Amount: invoice.amount_paid / 100,
      Currency: invoice.currency,
      DueDate: new Date(payment.nextPaymentDate),
      InvoiceURL: invoice.hosted_invoice_url,
      SupportEmail: 'suporte@barbershop.com.br',
      Year: new Date().getFullYear(),
    };

    try {
      await this.emailService.sendTemplateEmail(
        subscription.user.id,
        'invoice_email',
        context,
        {
          pt: `Pagamento recebido - Fatura ${invoice.id}`,
          en: `Payment received - Invoice ${invoice.id}`,
          es: `Pago recibido - Factura ${invoice.id}`,
        },
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
      if (await this.chairRent.handleInvoice(invoice, false)) return;
      await this.handleClientSubscriptionInvoiceFailed(subscriptionId);
      return;
    }

    // Atualizar status do usuário para pagamento em atraso
    await this.prisma.user.update({
      where: { id: subscription.userId },
      // Sem isActive: false — isso bloqueava o login e a pessoa não
      // conseguia nem entrar pra trocar o cartão
      data: {
        membership: MEMBERSHIP_STATUS.PAST_DUE,
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

  // ============ ASSINATURA RECORRENTE DO CLIENTE ============
  // Fatura mensal cobrada com sucesso: reativa/renova o ciclo (zera
  // usedThisCycle) e registra o pagamento. amount_paid vem em centavos.
  private async handleClientSubscriptionInvoiceSucceeded(
    invoice: Stripe.Invoice,
    stripeSubscriptionId: string,
  ) {
    if (!stripeSubscriptionId) return;
    const subscription = await this.prisma.clientSubscription.findFirst({
      where: { stripeSubscriptionId },
    });
    if (!subscription) {
      this.logger.warn(
        `No subscription (owner or client) found for Stripe subscription ID: ${stripeSubscriptionId}`,
      );
      return;
    }

    const stripeSubscription = await this.stripeService.getSubscription(stripeSubscriptionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${
        'client-invoice:' + invoice.id
      }))`;
      const already = await tx.clientSubscriptionPayment.findUnique({
        where: { stripeInvoiceId: invoice.id },
      });
      // Evento repetido da mesma fatura: não zera de novo as sessões usadas
      // no ciclo (antes cada reenvio zerava o contador — sessões de graça)
      if (already?.status === 'SUCCEEDED') return;

      await tx.clientSubscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          usedThisCycle: 0,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        },
      });
      await tx.clientSubscriptionPayment.upsert({
        where: { stripeInvoiceId: invoice.id },
        create: {
          subscriptionId: subscription.id,
          stripeInvoiceId: invoice.id,
          amount: new Prisma.Decimal(invoice.amount_paid / 100),
          platformFeePercent: new Prisma.Decimal(currentPricing().platformFeePercent),
          status: 'SUCCEEDED',
          periodStart: new Date(stripeSubscription.current_period_start * 1000),
          periodEnd: new Date(stripeSubscription.current_period_end * 1000),
        },
        update: { status: 'SUCCEEDED' },
      });
    });
  }

  // Fatura falhou: marca como inadimplente. Não cancela sozinho — o Stripe
  // continua tentando conforme a configuração de retry da conta, e dispara
  // customer.subscription.deleted quando desistir de vez.
  private async handleClientSubscriptionInvoiceFailed(stripeSubscriptionId: string) {
    if (!stripeSubscriptionId) return;
    await this.prisma.clientSubscription.updateMany({
      where: { stripeSubscriptionId },
      data: { status: 'PAST_DUE' },
    });
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

    // Atualizar status baseado no status do Stripe. Só o plano muda: a conta
    // (isActive) fica ativa, senão quem atrasou nem entrava pra trocar o cartão
    let membershipStatus = MEMBERSHIP_STATUS.FREE;
    let planStatus = PLANO_STATUS.INACTIVE;

    switch (subscription.status) {
      case 'active':
        membershipStatus = MEMBERSHIP_STATUS.PAID;
        planStatus = PLANO_STATUS.ACTIVE;
        break;
      case 'past_due':
      case 'unpaid':
        membershipStatus = MEMBERSHIP_STATUS.PAST_DUE;
        break;
    }

    await this.prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        membership: membershipStatus,
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
      if (await this.chairRent.handleSubscriptionDeleted(subscription.id)) return;
      await this.prisma.clientSubscription.updateMany({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      return;
    }

    // Plano volta pro gratuito; a conta continua entrando
    await this.prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        membership: MEMBERSHIP_STATUS.FREE,
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

  // Antes só registrava no log: quem pagava e fechava a aba antes da tela
  // confirmar ficava cobrado e sem plano. Agora o webhook conclui também
  // (os dois caminhos são idempotentes).
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment intent succeeded: ${paymentIntent.id}`);
    const meta = paymentIntent.metadata ?? {};
    // Sinal de agendamento pago online (a tela também confirma; idempotente)
    if (meta.kind === 'appointment_deposit') {
      await this.deposits.finalize(paymentIntent);
      return;
    }
    // Caixinha pelo app (a tela também registra; idempotente)
    if (meta.kind === 'appointment_tip') {
      await this.tips.finalizeAppTip(paymentIntent);
      return;
    }
    // Atendimento pago antes pelo app (a tela também registra; idempotente)
    if (meta.kind === 'appointment_prepayment') {
      await this.prepayments.finalize(paymentIntent);
      return;
    }
    // Compra de Destaque (a tela também registra; idempotente)
    if (meta.kind === 'featured_purchase') {
      await this.featured.finalize(paymentIntent);
      return;
    }
    // Taxa por vaga preenchida (a tela também registra; idempotente)
    if (meta.kind === 'job_fill_fee') {
      await this.jobs.finalizeFee(paymentIntent);
      return;
    }
    if (meta.renewalKey) {
      const payment = await this.prisma.payment.findUnique({
        where: { renewalKey: meta.renewalKey },
      });
      if (payment) await this.paymentsService.finalizeRenewalPayment(payment.id);
      return;
    }
    if (meta.userId && meta.planId) {
      await this.paymentsService.confirmPaymentIntent(Number(meta.userId), paymentIntent.id);
    }
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
