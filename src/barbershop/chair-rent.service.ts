import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { BarbershopService } from './barbershop.service';
import { PLATFORM_SUBSCRIPTION_FEE_PERCENT } from './subscription.constants';

const MIN_RENT = 1;
const MAX_RENT = 100_000;

/**
 * Aluguel da cadeira no espaço compartilhado. O espaço (host) define o valor
 * mensal; o profissional independente (dono do negócio convidado) autoriza
 * um cartão salvo da conta dele e o Stripe cobra todo mês — cada fatura paga
 * é o recibo (link e PDF do Stripe).
 *
 * Como a assinatura do cliente final, a cobrança roda na conta da própria
 * plataforma (sem Stripe Connect): nenhum dos dois precisa abrir conta no
 * Stripe. O repasse ao espaço é reconciliação manual; a tela mostra quanto
 * foi recebido, a taxa da plataforma e o valor a repassar.
 */
@Injectable()
export class ChairRentService {
  private readonly logger = new Logger(ChairRentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly barbershopService: BarbershopService,
    private readonly activity: ActivityNotificationsService,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  private loadLink(linkId: number) {
    return this.prisma.sharedLocationMember.findUnique({
      where: { id: linkId },
      include: {
        host: { select: { id: true, name: true, currency: true } },
        member: { select: { id: true, name: true, ownerUserId: true } },
      },
    });
  }

  private async createPrice(
    link: { host: { name: string }; member: { name: string } },
    cents: number,
    currency: string,
  ) {
    const product = await this.stripe.createProduct(
      `Aluguel de cadeira — ${link.host.name}`,
      `Profissional: ${link.member.name}`,
    );
    const price = await this.stripe.createPrice(product.id, cents, currency.toLowerCase(), {
      interval: 'month',
    });
    return price.id;
  }

  private money(amount: number | Decimal, currency: string) {
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(amount));
    } catch {
      return `${Number(amount).toFixed(2)} ${currency}`;
    }
  }

  /**
   * O espaço define (ou muda) o aluguel mensal; null/0 encerra a cobrança.
   * Com a cobrança já rodando, o valor novo vale a partir da próxima fatura.
   */
  async setRent(userId: number, linkId: number, hostBarbershopId: number, amount: number | null) {
    await this.barbershopService.ensureAccess(userId, hostBarbershopId, 'manager');
    const link = await this.loadLink(linkId);
    if (!link || link.hostBarbershopId !== hostBarbershopId) {
      throw new NotFoundException('Vínculo não encontrado');
    }
    if (link.status !== 'ACTIVE') {
      throw new BadRequestException('O profissional precisa aceitar o convite antes do aluguel');
    }

    if (!amount) {
      await this.barbershopService.cancelChairRentsOfBarbershops([], link.id);
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: { rentAmount: null, rentStripePriceId: null, rentStatus: 'NONE' },
      });
      if (link.rentStatus !== 'NONE') {
        void this.activity.chairRentEvent(
          link.memberBarbershopId,
          'stopped',
          link.host.name,
          '',
          userId,
          `rent:${link.id}:stopped:${Date.now()}`,
        );
      }
      return this.view(link.id, hostBarbershopId);
    }

    if (!Number.isFinite(amount) || amount < MIN_RENT || amount > MAX_RENT) {
      throw new BadRequestException(`O aluguel precisa ficar entre ${MIN_RENT} e ${MAX_RENT}`);
    }
    const cents = Math.round(amount * 100);
    const currency = link.host.currency;
    if (link.rentAmount && Math.round(Number(link.rentAmount) * 100) === cents) {
      return this.view(link.id, hostBarbershopId);
    }

    let event: 'set' | 'changed' = 'set';
    let priceId: string | null = null;
    if (link.rentStripeSubscriptionId) {
      // Já cobrando: troca o preço a partir da próxima fatura, sem proporcional
      priceId = await this.createPrice(link, cents, currency);
      const sub = await this.stripe.getSubscription(link.rentStripeSubscriptionId);
      await this.stripe.updateSubscription(link.rentStripeSubscriptionId, {
        items: [{ id: sub.items.data[0].id, price: priceId }],
        proration_behavior: 'none',
      });
      event = 'changed';
    }
    // Sem cobrança rodando, o preço no Stripe só é criado quando o
    // profissional autoriza (definir o valor não depende do Stripe)
    await this.prisma.sharedLocationMember.update({
      where: { id: link.id },
      data: {
        rentAmount: new Decimal(cents / 100),
        rentCurrency: currency,
        rentStripePriceId: priceId,
        rentStatus: link.rentStripeSubscriptionId ? link.rentStatus : 'AWAITING_PAYMENT',
      },
    });
    void this.activity.chairRentEvent(
      link.memberBarbershopId,
      event,
      link.host.name,
      this.money(cents / 100, currency),
      userId,
      `rent:${link.id}:${event}:${cents}:${Date.now()}`,
    );
    return this.view(link.id, hostBarbershopId);
  }

  /**
   * O profissional (dono do negócio convidado) autoriza a cobrança mensal
   * com um cartão salvo da conta dele. Com a cobrança recusada (PAST_DUE),
   * o mesmo passo troca o cartão e tenta a fatura em aberto na hora.
   */
  async authorize(
    userId: number,
    linkId: number,
    memberBarbershopId: number,
    paymentMethodId: string,
  ) {
    await this.barbershopService.ensureAccess(userId, memberBarbershopId, 'owner');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    });
    if (!user?.stripeCustomerId) throw new BadRequestException('Salve um cartão antes');
    const pm = await this.stripe.retrievePaymentMethod(paymentMethodId).catch(() => null);
    const pmCustomer = typeof pm?.customer === 'string' ? pm.customer : pm?.customer?.id;
    if (!pm || pmCustomer !== user.stripeCustomerId) {
      throw new BadRequestException('Cartão não encontrado na sua conta');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Dois cliques juntos não criam duas cobranças mensais
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chair-rent:${linkId}`}))`;
        const link = await tx.sharedLocationMember.findUnique({
          where: { id: linkId },
          include: { host: { select: { name: true } }, member: { select: { name: true } } },
        });
        if (!link || link.memberBarbershopId !== memberBarbershopId) {
          throw new NotFoundException('Vínculo não encontrado');
        }
        if (link.status !== 'ACTIVE') throw new BadRequestException('Esse vínculo não está ativo');

        if (link.rentStripeSubscriptionId && link.rentStatus === 'PAST_DUE') {
          await this.stripe.updateSubscription(link.rentStripeSubscriptionId, {
            default_payment_method: paymentMethodId,
          });
          const sub = await this.stripe.getSubscription(link.rentStripeSubscriptionId);
          const invoiceId =
            typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
          if (invoiceId) {
            await this.stripe.payInvoice(invoiceId, paymentMethodId).catch((err) => {
              throw new BadRequestException(
                `O cartão foi recusado: ${(err as Error).message ?? 'tente outro cartão'}`,
              );
            });
          }
          return { link, clientSecret: null as string | null, event: null };
        }
        if (link.rentStatus !== 'AWAITING_PAYMENT' || !link.rentAmount) {
          throw new BadRequestException(
            link.rentStatus === 'NONE'
              ? 'O espaço ainda não definiu um aluguel'
              : 'A cobrança do aluguel já está autorizada',
          );
        }
        let priceId = link.rentStripePriceId;
        if (!priceId) {
          priceId = await this.createPrice(
            link,
            Math.round(Number(link.rentAmount) * 100),
            link.rentCurrency ?? 'BRL',
          );
          await tx.sharedLocationMember.update({
            where: { id: link.id },
            data: { rentStripePriceId: priceId },
          });
        }
        const sub = await this.stripe.createSubscription(
          user.stripeCustomerId!,
          priceId,
          {
            kind: 'chair-rent',
            sharedLocationMemberId: String(link.id),
            hostBarbershopId: String(link.hostBarbershopId),
            memberBarbershopId: String(link.memberBarbershopId),
          },
          // Um preço = uma assinatura: repetir a chamada devolve a mesma
          `chair-rent:${link.id}:${priceId}`,
          // Cartão só desta cobrança (não troca o cartão do plano do dono)
          { default_payment_method: paymentMethodId },
        );
        await tx.sharedLocationMember.update({
          where: { id: link.id },
          data: {
            rentStripeSubscriptionId: sub.id,
            rentPayerUserId: userId,
            rentStatus: sub.status === 'active' ? 'ACTIVE' : 'INCOMPLETE',
            rentPaidUntil: sub.status === 'active' ? new Date(sub.current_period_end * 1000) : null,
          },
        });
        const invoice = sub.latest_invoice as Stripe.Invoice | null;
        const intent = invoice?.payment_intent as Stripe.PaymentIntent | null;
        return {
          link,
          // Cartão que pede confirmação (3D Secure): o front confirma com isto
          clientSecret: sub.status === 'active' ? null : intent?.client_secret ?? null,
          event: 'started' as const,
        };
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    if (result.event) {
      void this.activity.chairRentEvent(
        result.link.hostBarbershopId,
        'started',
        (await this.loadLink(linkId))!.member.name,
        this.money(result.link.rentAmount ?? 0, result.link.rentCurrency ?? 'BRL'),
        userId,
        `rent:${linkId}:started:${Date.now()}`,
      );
    }
    return {
      link: await this.view(linkId, memberBarbershopId),
      clientSecret: result.clientSecret,
    };
  }

  /** Recibos (faturas do Stripe) do aluguel, pros dois lados. */
  async payments(userId: number, linkId: number, barbershopId: number) {
    const link = await this.loadLink(linkId);
    if (
      !link ||
      (link.hostBarbershopId !== barbershopId && link.memberBarbershopId !== barbershopId)
    ) {
      throw new NotFoundException('Vínculo não encontrado');
    }
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const rows = await this.prisma.chairRentPayment.findMany({
      where: { sharedLocationMemberId: linkId },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      receiptUrl: r.receiptUrl,
      receiptPdfUrl: r.receiptPdfUrl,
    }));
  }

  /** Aluguel do vínculo como a unidade vê (inclui o resumo do repasse pro espaço). */
  async view(linkId: number, viewerBarbershopId: number) {
    const link = await this.prisma.sharedLocationMember.findUniqueOrThrow({
      where: { id: linkId },
    });
    const received = await this.prisma.chairRentPayment.aggregate({
      where: { sharedLocationMemberId: linkId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const total = Number(received._sum.amount ?? 0);
    const fee = Math.round(total * PLATFORM_SUBSCRIPTION_FEE_PERCENT) / 100;
    return {
      linkId: link.id,
      isHost: link.hostBarbershopId === viewerBarbershopId,
      status: link.rentStatus,
      amount: link.rentAmount != null ? Number(link.rentAmount) : null,
      currency: link.rentCurrency,
      paidUntil: link.rentPaidUntil,
      totalReceived: total,
      platformFeePercent: PLATFORM_SUBSCRIPTION_FEE_PERCENT,
      // Só quem é o espaço vê o repasse; o profissional vê o que pagou
      payoutDue: link.hostBarbershopId === viewerBarbershopId ? total - fee : null,
    };
  }

  // ---- Webhook do Stripe ----
  // Os handlers devolvem false quando a assinatura não é de aluguel (o
  // controller segue procurando em outros tipos). Aguentam o mesmo evento
  // mais de uma vez.

  private async linkBySubscription(stripeSubscriptionId: string) {
    if (!stripeSubscriptionId) return null;
    return this.prisma.sharedLocationMember.findUnique({
      where: { rentStripeSubscriptionId: stripeSubscriptionId },
      include: {
        host: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
      },
    });
  }

  async handleInvoice(invoice: Stripe.Invoice, paid: boolean): Promise<boolean> {
    const link = await this.linkBySubscription((invoice.subscription as string) || '');
    if (!link) return false;
    const line = invoice.lines?.data?.[0];
    const periodStart = line?.period?.start ? new Date(line.period.start * 1000) : null;
    const periodEnd = line?.period?.end ? new Date(line.period.end * 1000) : null;
    const amount = (paid ? invoice.amount_paid : invoice.amount_due) / 100;
    const currency = (invoice.currency || link.rentCurrency || 'brl').toUpperCase();

    const firstTime = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rent-invoice:${invoice.id}`}))`;
      const existing = await tx.chairRentPayment.findUnique({
        where: { stripeInvoiceId: invoice.id },
      });
      // Pago não volta a "recusado" por um evento atrasado
      if (existing?.status === 'SUCCEEDED' || (existing && !paid)) return false;
      await tx.chairRentPayment.upsert({
        where: { stripeInvoiceId: invoice.id },
        create: {
          sharedLocationMemberId: link.id,
          stripeInvoiceId: invoice.id,
          amount: new Decimal(amount),
          currency,
          status: paid ? 'SUCCEEDED' : 'FAILED',
          periodStart,
          periodEnd,
          receiptUrl: invoice.hosted_invoice_url ?? null,
          receiptPdfUrl: invoice.invoice_pdf ?? null,
        },
        update: {
          status: paid ? 'SUCCEEDED' : 'FAILED',
          amount: new Decimal(amount),
          receiptUrl: invoice.hosted_invoice_url ?? null,
          receiptPdfUrl: invoice.invoice_pdf ?? null,
        },
      });
      await tx.sharedLocationMember.update({
        where: { id: link.id },
        data: paid
          ? { rentStatus: 'ACTIVE', ...(periodEnd ? { rentPaidUntil: periodEnd } : {}) }
          : { rentStatus: 'PAST_DUE' },
      });
      return true;
    });
    if (!firstTime) return true;

    const amountText = this.money(amount, currency);
    if (paid) {
      void this.activity.chairRentEvent(
        link.hostBarbershopId,
        'paid',
        link.member.name,
        amountText,
        null,
        `rent-invoice:${invoice.id}:paid`,
      );
      await this.sendReceipt(link.rentPayerUserId, invoice, amount, currency).catch((err) =>
        this.logger.error(`Recibo do aluguel (fatura ${invoice.id}) não saiu`, err),
      );
    } else {
      for (const [shopId, other] of [
        [link.memberBarbershopId, link.host.name],
        [link.hostBarbershopId, link.member.name],
      ] as const) {
        void this.activity.chairRentEvent(
          shopId,
          'failed',
          other,
          amountText,
          null,
          `rent-invoice:${invoice.id}:failed:${shopId}`,
        );
      }
    }
    return true;
  }

  /** Stripe desistiu (tentativas esgotadas) ou a assinatura foi cancelada por fora. */
  async handleSubscriptionDeleted(stripeSubscriptionId: string): Promise<boolean> {
    const link = await this.linkBySubscription(stripeSubscriptionId);
    if (!link) return false;
    await this.prisma.sharedLocationMember.update({
      where: { id: link.id },
      // Continua com o valor: o profissional autoriza de novo se quiser seguir
      data: {
        rentStripeSubscriptionId: null,
        rentStatus: link.rentAmount && link.status === 'ACTIVE' ? 'AWAITING_PAYMENT' : 'NONE',
        rentStripePriceId: link.rentAmount ? link.rentStripePriceId : null,
      },
    });
    for (const [shopId, other] of [
      [link.memberBarbershopId, link.host.name],
      [link.hostBarbershopId, link.member.name],
    ] as const) {
      void this.activity.chairRentEvent(
        shopId,
        'stopped',
        other,
        '',
        null,
        `rent-sub:${stripeSubscriptionId}:deleted:${shopId}`,
      );
    }
    return true;
  }

  private async sendReceipt(
    payerUserId: number | null,
    invoice: Stripe.Invoice,
    amount: number,
    currency: string,
  ) {
    if (!payerUserId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: payerUserId },
      select: { id: true, email: true, fullName: true },
    });
    if (!user) return;
    await this.notificationQueue.email(
      {
        kind: 'user',
        userId: user.id,
        template: 'invoice_email',
        context: {
          FullName: user.fullName,
          AppName: 'Barbershop',
          InvoiceID: invoice.number ?? invoice.id,
          Amount: amount,
          Currency: currency,
          DueDate: new Date(invoice.created * 1000),
          InvoiceURL: invoice.hosted_invoice_url,
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        subject: {
          pt: `Recibo do aluguel da cadeira — ${invoice.number ?? invoice.id}`,
          en: `Chair rent receipt — ${invoice.number ?? invoice.id}`,
          es: `Recibo del alquiler de la silla — ${invoice.number ?? invoice.id}`,
        },
        meta: 'chair-rent-receipt',
        to: user.email,
      },
      `chair-rent-receipt-${invoice.id}`,
    );
  }
}
