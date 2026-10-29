import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  Logger,
  Get,
  InternalServerErrorException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
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
import { fromMinorUnits } from '../common/money-units';
import { supportEmail } from '../common/app-urls';
import { timeZoneForOwner } from '../common/owner-timezone';

/** Fim do período da fatura (linhas, senão o period_end). */
function clientInvoicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  const fromLines = (invoice.lines?.data ?? []).reduce(
    (max, line) => Math.max(max, line.period?.end ?? 0),
    0,
  );
  const sec = fromLines || invoice.period_end || 0;
  return sec ? new Date(sec * 1000) : null;
}

@ApiTags('stripe')
@Controller('stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);
  private stripeHealthAt = 0;
  private stripeHealthValue = false;

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
          await this.handleDispute(event.data.object as Stripe.Dispute);
          break;
        // Estorno pelo painel da Stripe (ou que ficou pendente e depois confirmou)
        case 'charge.refunded':
          await this.appPayments.syncStripeRefund(event.data.object as Stripe.Charge);
          await this.paymentsService.syncPlanRefund(event.data.object as Stripe.Charge);
          await this.syncChairRentRefund(event.data.object as Stripe.Charge);
          break;
        case 'refund.updated': {
          const refund = event.data.object as Stripe.Refund;
          if (refund.status !== 'succeeded') break;
          const chargeId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id;
          if (!chargeId) break;
          const charge = await this.stripeService.retrieveCharge(chargeId);
          await this.appPayments.syncStripeRefund(charge);
          await this.paymentsService.syncPlanRefund(charge);
          await this.syncChairRentRefund(charge);
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

    // Assinatura já encerrada não volta por fatura atrasada (item 306).
    // Evento repetido também não reativa o que o Stripe já cancelou.
    const live =
      subscription.status === PLANO_STATUS.INACTIVE
        ? null
        : await this.stripeService.getSubscription(subscriptionId).catch(() => null);
    if (subscription.status !== PLANO_STATUS.INACTIVE && (!live || live.status === 'active')) {
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

      // Renovação paga: o plano menor agendado (changePlan) entra agora
      const renewal = invoice.billing_reason === 'subscription_cycle';
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: PLANO_STATUS.ACTIVE,
          ...(renewal && subscription.pendingPlanId != null
            ? { planId: subscription.pendingPlanId, pendingPlanId: null }
            : {}),
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
          amount: new Prisma.Decimal(fromMinorUnits(invoice.amount_paid, invoice.currency)),
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
      Amount: fromMinorUnits(invoice.amount_paid, invoice.currency),
      Currency: invoice.currency,
      DueDate: new Date(payment.nextPaymentDate),
      InvoiceURL: invoice.hosted_invoice_url,
      SupportEmail: supportEmail(),
      Year: new Date().getFullYear(),
      TimeZone: await timeZoneForOwner(this.prisma, subscription.user.id),
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
      // conseguia nem entrar pra trocar o cartão. A assinatura continua
      // ativa: a Stripe ainda vai tentar de novo (item 307).
      data: {
        membership: MEMBERSHIP_STATUS.PAST_DUE,
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
    const invoiceEnd = clientInvoicePeriodEnd(invoice);
    // Fatura de um ciclo já passado: só registra o pagamento. Não zera as
    // sessões do ciclo atual (item 309).
    const advancesCycle =
      !subscription.currentPeriodStart ||
      (invoiceEnd != null && invoiceEnd > subscription.currentPeriodStart);
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

      if (advancesCycle) {
        await tx.clientSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            usedThisCycle: 0,
            currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
            currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          },
        });
      }
      // A taxa da conta conectada é a da assinatura (o Stripe já descontou
      // essa). A da plataforma é a de hoje, porque o repasse ainda vai sair.
      const feePercent = subscription.connectAccountId
        ? Number(subscription.applicationFeePercent ?? currentPricing().platformFeePercent)
        : currentPricing().platformFeePercent;
      const settledViaConnect = subscription.connectAccountId != null;
      await tx.clientSubscriptionPayment.upsert({
        where: { stripeInvoiceId: invoice.id },
        create: {
          subscriptionId: subscription.id,
          stripeInvoiceId: invoice.id,
          amount: new Prisma.Decimal(fromMinorUnits(invoice.amount_paid, invoice.currency)),
          platformFeePercent: new Prisma.Decimal(feePercent),
          settledViaConnect,
          status: 'SUCCEEDED',
          periodStart: new Date(stripeSubscription.current_period_start * 1000),
          periodEnd: new Date(stripeSubscription.current_period_end * 1000),
        },
        update: {
          status: 'SUCCEEDED',
          platformFeePercent: new Prisma.Decimal(feePercent),
          settledViaConnect,
        },
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

  /** Disputa perdida: o dinheiro voltou ao cliente, como num estorno */
  private async handleDispute(dispute: Stripe.Dispute) {
    if (!(await this.appPayments.recordDispute(dispute))) return;
    const charge = await this.appPayments.chargeOfLostDispute(dispute);
    if (!charge) return;
    await this.appPayments.syncStripeRefund(charge);
    await this.paymentsService.syncPlanRefund(charge);
    await this.syncChairRentRefund(charge);
  }

  /** Aluguel da cadeira estornado (fatura da assinatura do aluguel) */
  private async syncChairRentRefund(charge: Stripe.Charge) {
    const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
    const refunded = fromMinorUnits(charge.amount_refunded ?? 0, charge.currency);
    if (!invoiceId || refunded <= 0) return;
    await this.chairRent.syncRefund(invoiceId, refunded, charge.refunded);
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
      await this.syncClientClub(subscription);
      return;
    }

    // past_due mantém o plano (a Stripe ainda tenta). trialing conta como
    // ativo. Só o encerramento de verdade volta ao gratuito (item 307).
    if (
      subscription.status === 'canceled' ||
      subscription.status === 'unpaid' ||
      subscription.status === 'incomplete_expired'
    ) {
      await this.paymentsService.releaseToFreePlan(dbSubscription.id, dbSubscription.userId);
      return;
    }
    if (
      subscription.status !== 'active' &&
      subscription.status !== 'trialing' &&
      subscription.status !== 'past_due'
    ) {
      return;
    }

    await this.prisma.user.update({
      where: { id: dbSubscription.userId },
      data: {
        membership:
          subscription.status === 'past_due' ? MEMBERSHIP_STATUS.PAST_DUE : MEMBERSHIP_STATUS.PAID,
      },
    });

    await this.prisma.subscription.update({
      where: { id: dbSubscription.id },
      data: { status: PLANO_STATUS.ACTIVE },
    });
  }

  /** O mesmo aviso da Stripe também chega na assinatura do clube (item 308). */
  private async syncClientClub(subscription: Stripe.Subscription) {
    const status =
      subscription.status === 'active'
        ? 'ACTIVE'
        : subscription.status === 'past_due'
        ? 'PAST_DUE'
        : subscription.status === 'incomplete_expired' ||
          subscription.status === 'canceled' ||
          subscription.status === 'unpaid'
        ? 'CANCELED'
        : null;
    if (!status) return;
    await this.prisma.clientSubscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        ...(status === 'CANCELED' ? { canceledAt: new Date() } : {}),
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @ApiOperation({ summary: 'Check Stripe health' })
  @ApiResponse({ status: 200 })
  async checkHealth() {
    const now = Date.now();
    if (this.stripeHealthAt && now - this.stripeHealthAt < 60_000) {
      return { available: this.stripeHealthValue, timestamp: new Date().toISOString() };
    }
    const isAvailable = await this.stripeService.isAvailable();
    this.stripeHealthAt = now;
    this.stripeHealthValue = isAvailable;
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
