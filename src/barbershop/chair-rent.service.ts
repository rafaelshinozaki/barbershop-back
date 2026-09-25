import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CHAIR_RENT_QUEUE } from '../queue/queue.constants';
import { registerSchedulers } from '../queue/register-schedulers';
import { Decimal } from '@prisma/client/runtime/library';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificationQueueService } from '../queue/notification-queue.service';
import { ActivityNotificationsService } from '../notifications/activity-notifications.service';
import { BarbershopService } from './barbershop.service';
import { PLATFORM_SUBSCRIPTION_FEE_PERCENT } from './subscription.constants';
import { safeTimeZone, toZonedParts } from '../common/timezone.util';

const MIN_RENT = 1;
const MAX_RENT = 100_000;
const DAY_MS = 86_400_000;

export type RentBillingMode = 'CARD' | 'MANUAL';
/** Como o espaço recebeu o aluguel pago direto a ele */
export const MANUAL_RENT_METHODS = ['CASH', 'PIX', 'TRANSFER', 'OTHER'] as const;
export type ManualRentMethod = (typeof MANUAL_RENT_METHODS)[number];

/** Mesmo dia do mês seguinte (dia 29–31 vira 28, pra todo mês ter vencimento). */
function addMonth(date: Date, dueDay: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12));
  d.setUTCDate(dueDay);
  return d;
}

/**
 * Vencimento = um dia do calendário, gravado ao meio-dia UTC. O dia é o do
 * espaço (fuso da unidade), não o do servidor: às 22h em São Paulo ainda é
 * "hoje" lá, mesmo já sendo amanhã em UTC.
 */
export function dueDateOf(date: Date, timeZone: string): Date {
  const [y, m, d] = toZonedParts(date, timeZone).dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** O vencimento já chegou no calendário do espaço? */
export function dueReached(due: Date, timeZone: string, now = new Date()): boolean {
  return due.toISOString().slice(0, 10) <= toZonedParts(now, timeZone).dateStr;
}

/**
 * Aluguel da cadeira no espaço compartilhado. O espaço (host) define o valor
 * mensal e como recebe:
 * - CARD: o profissional independente (dono do negócio convidado) autoriza
 *   um cartão salvo da conta dele e o Stripe cobra todo mês — cada fatura
 *   paga é o recibo (link e PDF do Stripe);
 * - MANUAL: pago direto ao espaço (PIX, dinheiro, transferência...). O
 *   sistema gera a mensalidade todo mês, o espaço registra o pagamento com o
 *   método, sai recibo, e o que foi em dinheiro entra no caixa aberto.
 * Nos dois, cada pagamento vira despesa "Aluguel" no negócio do profissional
 * — cada lado vê quanto recebe/paga.
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
        host: { select: { id: true, name: true, currency: true, timezone: true } },
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
  async setRent(
    userId: number,
    linkId: number,
    hostBarbershopId: number,
    amount: number | null,
    mode?: RentBillingMode | null,
  ) {
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
      // Mensalidades manuais já vencidas continuam em aberto (é dívida); só
      // param de ser geradas
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: {
          rentAmount: null,
          rentStripePriceId: null,
          rentStatus: 'NONE',
          rentStartedAt: null,
        },
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
    const newMode: RentBillingMode = mode ?? (link.rentBillingMode as RentBillingMode);
    if (newMode !== 'CARD' && newMode !== 'MANUAL') {
      throw new BadRequestException('Forma de cobrança inválida');
    }
    const sameAmount = link.rentAmount && Math.round(Number(link.rentAmount) * 100) === cents;
    if (sameAmount && newMode === link.rentBillingMode && link.rentStatus !== 'NONE') {
      return this.view(link.id, hostBarbershopId);
    }

    if (newMode === 'MANUAL') {
      // Pago direto ao espaço: cartão (se havia) deixa de ser cobrado
      await this.barbershopService.cancelChairRentsOfBarbershops([], link.id);
      const wasManual = link.rentBillingMode === 'MANUAL' && link.rentStartedAt;
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: {
          rentAmount: new Decimal(cents / 100),
          rentCurrency: currency,
          rentBillingMode: 'MANUAL',
          rentStripePriceId: null,
          rentStatus: 'ACTIVE',
          // Primeira mensalidade vence hoje; as próximas, no mesmo dia do mês
          rentStartedAt: wasManual
            ? link.rentStartedAt
            : dueDateOf(new Date(), safeTimeZone(link.host.timezone)),
        },
      });
      await this.ensureDues(link.id);
      void this.activity.chairRentEvent(
        link.memberBarbershopId,
        wasManual ? 'changed' : 'manualSet',
        link.host.name,
        this.money(cents / 100, currency),
        userId,
        `rent:${link.id}:manual:${cents}:${Date.now()}`,
      );
      return this.view(link.id, hostBarbershopId);
    }
    if (link.rentBillingMode === 'MANUAL') {
      // Voltou pro cartão: o profissional autoriza; mensalidades manuais em
      // aberto continuam a receber
      await this.prisma.sharedLocationMember.update({
        where: { id: link.id },
        data: { rentBillingMode: 'CARD', rentStartedAt: null, rentStatus: 'NONE' },
      });
      link.rentBillingMode = 'CARD';
      link.rentStatus = 'NONE';
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
        if (link.rentBillingMode === 'MANUAL') {
          throw new BadRequestException(
            'Este aluguel é pago direto ao espaço (PIX, dinheiro ou transferência)',
          );
        }

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

  /**
   * Gera as mensalidades manuais que já venceram (uma por mês, desde
   * rentStartedAt). Idempotente: o índice único (vínculo, vencimento) não
   * deixa duplicar, nem com duas chamadas juntas. Devolve quantas criou.
   */
  private async hostTimeZone(hostBarbershopId: number) {
    const host = await this.prisma.barbershop.findUnique({
      where: { id: hostBarbershopId },
      select: { timezone: true },
    });
    return safeTimeZone(host?.timezone);
  }

  async ensureDues(linkId: number): Promise<number> {
    const link = await this.prisma.sharedLocationMember.findUnique({ where: { id: linkId } });
    if (
      !link ||
      link.status !== 'ACTIVE' ||
      link.rentBillingMode !== 'MANUAL' ||
      !link.rentAmount ||
      !link.rentStartedAt
    ) {
      return 0;
    }
    const timeZone = await this.hostTimeZone(link.hostBarbershopId);
    const dueDay = Math.min(link.rentStartedAt.getUTCDate(), 28);
    const dates: Date[] = [];
    let d = link.rentStartedAt;
    for (let i = 0; i < 240 && dueReached(d, timeZone); i++) {
      dates.push(d);
      d = addMonth(d, dueDay);
    }
    if (dates.length === 0) return 0;
    const existing = await this.prisma.chairRentPayment.findMany({
      where: { sharedLocationMemberId: link.id, dueDate: { in: dates } },
      select: { dueDate: true },
    });
    const have = new Set(existing.map((e) => e.dueDate!.getTime()));
    const missing = dates.filter((x) => !have.has(x.getTime()));
    if (missing.length === 0) return 0;
    const created = await this.prisma.chairRentPayment.createMany({
      data: missing.map((dueDate) => ({
        sharedLocationMemberId: link.id,
        amount: link.rentAmount!,
        currency: link.rentCurrency ?? 'BRL',
        status: 'DUE',
        method: 'OTHER',
        dueDate,
        periodStart: dueDate,
        periodEnd: addMonth(dueDate, dueDay),
      })),
      skipDuplicates: true,
    });
    if (created.count > 0) {
      const latest = missing[missing.length - 1];
      const host = await this.prisma.barbershop.findUnique({
        where: { id: link.hostBarbershopId },
        select: { name: true },
      });
      void this.activity.chairRentEvent(
        link.memberBarbershopId,
        'due',
        host?.name ?? '',
        this.money(link.rentAmount, link.rentCurrency ?? 'BRL'),
        null,
        `rent-due:${link.id}:${latest.getTime()}`,
      );
    }
    return created.count;
  }

  private async loadPayment(paymentId: number) {
    return this.prisma.chairRentPayment.findUnique({
      where: { id: paymentId },
      include: {
        link: {
          include: {
            host: { select: { id: true, name: true } },
            member: { select: { id: true, name: true, ownerUserId: true } },
          },
        },
      },
    });
  }

  /**
   * O espaço registra o aluguel que recebeu direto (PIX, dinheiro,
   * transferência...). Dinheiro entra no caixa aberto do espaço; no negócio
   * do profissional vira despesa "Aluguel". Sai recibo pros dois.
   */
  async recordPayment(
    userId: number,
    paymentId: number,
    hostBarbershopId: number,
    method: string,
    notes?: string | null,
  ) {
    await this.barbershopService.ensureAccess(userId, hostBarbershopId, 'manager');
    if (!(MANUAL_RENT_METHODS as readonly string[]).includes(method)) {
      throw new BadRequestException('Forma de pagamento inválida');
    }
    const payment = await this.loadPayment(paymentId);
    if (!payment || payment.link.hostBarbershopId !== hostBarbershopId) {
      throw new NotFoundException('Mensalidade não encontrada');
    }
    if (payment.status !== 'DUE') throw new BadRequestException('Essa mensalidade já foi paga');

    const cashSession =
      method === 'CASH'
        ? await this.prisma.cashSession.findFirst({
            where: { barbershopId: hostBarbershopId, status: 'OPEN' },
            select: { id: true },
          })
        : null;
    const paidAt = new Date();
    // Condicional no status: dois cliques não registram (nem lançam despesa) duas vezes
    const updated = await this.prisma.chairRentPayment.updateMany({
      where: { id: payment.id, status: 'DUE' },
      data: {
        status: 'SUCCEEDED',
        method,
        paidAt,
        notes: notes?.trim() || null,
        recordedByUserId: userId,
        cashSessionId: cashSession?.id ?? null,
      },
    });
    if (updated.count === 0) throw new BadRequestException('Essa mensalidade já foi paga');

    const expenseId = await this.createMemberExpense(
      payment.link,
      Number(payment.amount),
      method,
      paidAt,
    );
    if (expenseId) {
      await this.prisma.chairRentPayment.update({
        where: { id: payment.id },
        data: { memberExpenseId: expenseId },
      });
    }
    void this.activity.chairRentEvent(
      payment.link.memberBarbershopId,
      'received',
      payment.link.host.name,
      this.money(payment.amount, payment.currency),
      userId,
      `rent-paid:${payment.id}:${paidAt.getTime()}`,
    );
    await this.sendManualReceipt(payment.id).catch((err) =>
      this.logger.error(`Recibo do aluguel #${payment.id} não saiu`, err),
    );
    return this.paymentView(payment.id);
  }

  /** Registro errado: a mensalidade volta a ficar em aberto (e sai do caixa e da despesa). */
  async undoPayment(userId: number, paymentId: number, hostBarbershopId: number) {
    await this.barbershopService.ensureAccess(userId, hostBarbershopId, 'manager');
    const payment = await this.loadPayment(paymentId);
    if (!payment || payment.link.hostBarbershopId !== hostBarbershopId) {
      throw new NotFoundException('Mensalidade não encontrada');
    }
    if (payment.status !== 'SUCCEEDED' || payment.method === 'CARD' || !payment.dueDate) {
      throw new BadRequestException('Só dá pra desfazer pagamento registrado à mão');
    }
    if (payment.cashSessionId) {
      const session = await this.prisma.cashSession.findUnique({
        where: { id: payment.cashSessionId },
        select: { status: true },
      });
      if (session?.status === 'CLOSED') {
        throw new BadRequestException(
          'O caixa em que esse dinheiro entrou já foi fechado. Lance a correção no caixa.',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      if (payment.memberExpenseId) {
        await tx.expense.deleteMany({ where: { id: payment.memberExpenseId } });
      }
      await tx.chairRentPayment.update({
        where: { id: payment.id },
        data: {
          status: 'DUE',
          method: 'OTHER',
          paidAt: null,
          notes: null,
          recordedByUserId: null,
          cashSessionId: null,
          memberExpenseId: null,
        },
      });
    });
    return this.paymentView(payment.id);
  }

  /** Aluguel pago vira despesa "Aluguel" no negócio do profissional. */
  private async createMemberExpense(
    link: {
      memberBarbershopId: number;
      host: { name: string };
      member: { ownerUserId: number | null };
      rentPayerUserId?: number | null;
    },
    amount: number,
    method: string,
    paidAt: Date,
  ) {
    const createdBy = link.member.ownerUserId ?? link.rentPayerUserId;
    if (!createdBy) return null;
    const expense = await this.prisma.expense.create({
      data: {
        barbershopId: link.memberBarbershopId,
        category: 'RENT',
        description: `Aluguel da cadeira — ${link.host.name}`,
        amount: new Decimal(amount),
        paymentMethod: method,
        expenseDate: paidAt,
        createdByUserId: createdBy,
      },
      select: { id: true },
    });
    return expense.id;
  }

  private receiptNumber(id: number) {
    return `ALG-${String(id).padStart(6, '0')}`;
  }

  private async paymentView(paymentId: number) {
    const r = await this.prisma.chairRentPayment.findUniqueOrThrow({ where: { id: paymentId } });
    const recordedBy = r.recordedByUserId
      ? await this.prisma.user.findUnique({
          where: { id: r.recordedByUserId },
          select: { fullName: true },
        })
      : null;
    return this.toPaymentView(r, recordedBy?.fullName ?? null);
  }

  private toPaymentView(
    r: {
      id: number;
      createdAt: Date;
      amount: Decimal;
      currency: string;
      status: string;
      method: string;
      dueDate: Date | null;
      paidAt: Date | null;
      notes: string | null;
      periodStart: Date | null;
      periodEnd: Date | null;
      receiptUrl: string | null;
      receiptPdfUrl: string | null;
    },
    recordedByName: string | null,
  ) {
    return {
      id: r.id,
      createdAt: r.createdAt,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      method: r.method,
      dueDate: r.dueDate,
      paidAt: r.paidAt,
      overdue: r.status === 'DUE' && !!r.dueDate && r.dueDate.getTime() + DAY_MS < Date.now(),
      notes: r.notes,
      recordedByName,
      receiptNumber: r.status === 'SUCCEEDED' ? this.receiptNumber(r.id) : null,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      receiptUrl: r.receiptUrl,
      receiptPdfUrl: r.receiptPdfUrl,
    };
  }

  /** Mensalidades e recibos do aluguel, pros dois lados. */
  async payments(userId: number, linkId: number, barbershopId: number) {
    const link = await this.loadLink(linkId);
    if (
      !link ||
      (link.hostBarbershopId !== barbershopId && link.memberBarbershopId !== barbershopId)
    ) {
      throw new NotFoundException('Vínculo não encontrado');
    }
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    await this.ensureDues(linkId);
    const rows = await this.prisma.chairRentPayment.findMany({
      where: { sharedLocationMemberId: linkId },
      // Em aberto primeiro, depois do mais recente pro mais antigo
      orderBy: [{ status: 'asc' }, { dueDate: 'desc' }, { createdAt: 'desc' }],
      take: 60,
    });
    const userIds = [...new Set(rows.map((r) => r.recordedByUserId).filter(Boolean))] as number[];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) =>
      this.toPaymentView(r, r.recordedByUserId ? names.get(r.recordedByUserId) ?? null : null),
    );
  }

  /** Recibo de um pagamento (pra imprimir/mandar), pros dois lados. */
  async receipt(userId: number, paymentId: number, barbershopId: number) {
    const payment = await this.loadPayment(paymentId);
    if (
      !payment ||
      (payment.link.hostBarbershopId !== barbershopId &&
        payment.link.memberBarbershopId !== barbershopId)
    ) {
      throw new NotFoundException('Recibo não encontrado');
    }
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    if (payment.status !== 'SUCCEEDED')
      throw new BadRequestException('Essa mensalidade não foi paga');
    const [host, member] = await Promise.all(
      [payment.link.hostBarbershopId, payment.link.memberBarbershopId].map((id) =>
        this.prisma.barbershop.findUniqueOrThrow({
          where: { id },
          select: { name: true, address: true, city: true, state: true, email: true, phone: true },
        }),
      ),
    );
    return {
      ...(await this.paymentView(payment.id)),
      hostName: host.name,
      hostAddress: `${host.address}, ${host.city} - ${host.state}`,
      memberName: member.name,
      memberAddress: `${member.address}, ${member.city} - ${member.state}`,
    };
  }

  /** Aluguel do vínculo como a unidade vê (inclui o resumo do repasse pro espaço). */
  async view(linkId: number, viewerBarbershopId: number) {
    await this.ensureDues(linkId);
    const link = await this.prisma.sharedLocationMember.findUniqueOrThrow({
      where: { id: linkId },
    });
    const [byMethod, open] = await Promise.all([
      this.prisma.chairRentPayment.groupBy({
        by: ['method'],
        where: { sharedLocationMemberId: linkId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      }),
      this.prisma.chairRentPayment.findMany({
        where: { sharedLocationMemberId: linkId, status: 'DUE' },
        select: { amount: true, dueDate: true },
        orderBy: { dueDate: 'asc' },
      }),
    ]);
    const total = byMethod.reduce((sum, m) => sum + Number(m._sum.amount ?? 0), 0);
    // Taxa da plataforma só no que passou pelo Stripe; o manual já é do espaço
    const card = Number(byMethod.find((m) => m.method === 'CARD')?._sum.amount ?? 0);
    const fee = Math.round(card * PLATFORM_SUBSCRIPTION_FEE_PERCENT) / 100;
    const openAmount = open.reduce((sum, d) => sum + Number(d.amount), 0);
    const overdue = open.some((d) => d.dueDate && d.dueDate.getTime() + DAY_MS < Date.now());
    const manual = link.rentBillingMode === 'MANUAL';
    let nextDueDate: Date | null = null;
    if (manual && link.rentStartedAt && link.rentAmount) {
      const timeZone = await this.hostTimeZone(link.hostBarbershopId);
      const dueDay = Math.min(link.rentStartedAt.getUTCDate(), 28);
      let d = link.rentStartedAt;
      for (let i = 0; i < 240 && dueReached(d, timeZone); i++) d = addMonth(d, dueDay);
      nextDueDate = d;
    }
    let status = link.rentStatus;
    if (manual && link.rentStatus !== 'NONE') {
      status = overdue ? 'PAST_DUE' : openAmount > 0 ? 'DUE' : 'ACTIVE';
    } else if (link.rentStatus === 'NONE' && openAmount > 0) {
      // Parou de cobrar, mas ficou mensalidade em aberto
      status = overdue ? 'PAST_DUE' : 'DUE';
    }
    const isHost = link.hostBarbershopId === viewerBarbershopId;
    return {
      linkId: link.id,
      isHost,
      status,
      billingMode: link.rentBillingMode,
      amount: link.rentAmount != null ? Number(link.rentAmount) : null,
      currency: link.rentCurrency,
      paidUntil: link.rentPaidUntil,
      nextDueDate,
      openAmount,
      totalReceived: total,
      platformFeePercent: PLATFORM_SUBSCRIPTION_FEE_PERCENT,
      // Só quem é o espaço vê o repasse (do que entrou pelo cartão)
      payoutDue: isHost ? card - fee : null,
    };
  }

  /**
   * Rotina diária: gera as mensalidades manuais do dia e avisa uma vez os
   * dois lados de cada mensalidade que passou do vencimento.
   */
  async processManualDues() {
    const links = await this.prisma.sharedLocationMember.findMany({
      where: { status: 'ACTIVE', rentBillingMode: 'MANUAL', rentAmount: { not: null } },
      select: { id: true },
    });
    for (const l of links) await this.ensureDues(l.id);
    const overdue = await this.prisma.chairRentPayment.findMany({
      where: {
        status: 'DUE',
        overdueNotifiedAt: null,
        dueDate: { lt: new Date(Date.now() - DAY_MS) },
      },
      include: {
        link: { include: { host: { select: { name: true } }, member: { select: { name: true } } } },
      },
      take: 500,
    });
    for (const p of overdue) {
      const claimed = await this.prisma.chairRentPayment.updateMany({
        where: { id: p.id, overdueNotifiedAt: null },
        data: { overdueNotifiedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      const amountText = this.money(p.amount, p.currency);
      for (const [shopId, other] of [
        [p.link.memberBarbershopId, p.link.host.name],
        [p.link.hostBarbershopId, p.link.member.name],
      ] as const) {
        void this.activity.chairRentEvent(
          shopId,
          'overdue',
          other,
          amountText,
          null,
          `rent-overdue:${p.id}:${shopId}`,
        );
      }
    }
    return overdue.length;
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
          method: 'CARD',
          paidAt: paid ? new Date() : null,
          status: paid ? 'SUCCEEDED' : 'FAILED',
          periodStart,
          periodEnd,
          receiptUrl: invoice.hosted_invoice_url ?? null,
          receiptPdfUrl: invoice.invoice_pdf ?? null,
        },
        update: {
          status: paid ? 'SUCCEEDED' : 'FAILED',
          paidAt: paid ? new Date() : null,
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
      const member = await this.prisma.barbershop.findUnique({
        where: { id: link.memberBarbershopId },
        select: { ownerUserId: true },
      });
      const expenseId = await this.createMemberExpense(
        { ...link, member: { ownerUserId: member?.ownerUserId ?? null } },
        amount,
        'CARD',
        new Date(),
      ).catch((err) => {
        this.logger.error(`Despesa do aluguel (fatura ${invoice.id}) não lançada`, err);
        return null;
      });
      if (expenseId) {
        await this.prisma.chairRentPayment.update({
          where: { stripeInvoiceId: invoice.id },
          data: { memberExpenseId: expenseId },
        });
      }
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

  /** Recibo do pagamento manual por e-mail pro dono do negócio do profissional. */
  private async sendManualReceipt(paymentId: number) {
    const payment = await this.loadPayment(paymentId);
    const ownerId = payment?.link.member.ownerUserId;
    if (!payment || !ownerId) return;
    const user = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, email: true, fullName: true },
    });
    if (!user) return;
    const number = this.receiptNumber(payment.id);
    const front = process.env.FRONTEND_URL || 'http://localhost:5173';
    await this.notificationQueue.email(
      {
        kind: 'user',
        userId: user.id,
        template: 'invoice_email',
        context: {
          FullName: user.fullName,
          AppName: 'Barbershop',
          InvoiceID: number,
          Amount: Number(payment.amount),
          Currency: payment.currency,
          DueDate: payment.dueDate ?? payment.paidAt ?? new Date(),
          InvoiceURL: `${front}/rent-receipt/${payment.id}?b=${payment.link.memberBarbershopId}`,
          SupportEmail: 'suporte@barbershop.com.br',
          Year: new Date().getFullYear(),
        },
        subject: {
          pt: `Recibo do aluguel da cadeira — ${number}`,
          en: `Chair rent receipt — ${number}`,
          es: `Recibo del alquiler de la silla — ${number}`,
        },
        meta: 'chair-rent-receipt',
        to: user.email,
      },
      `chair-rent-receipt-${payment.id}-${payment.paidAt?.getTime() ?? 0}`,
    );
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

/** Mensalidades manuais do aluguel: uma execução por hora, uma só no cluster. */
@Injectable()
export class ChairRentScheduler implements OnModuleInit {
  constructor(@InjectQueue(CHAIR_RENT_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    registerSchedulers(this.queue, [
      { id: 'process-manual-dues', repeat: { every: 60 * 60 * 1000 } },
    ]);
  }
}

@Processor(CHAIR_RENT_QUEUE)
export class ChairRentProcessor extends WorkerHost {
  constructor(private readonly chairRent: ChairRentService) {
    super();
  }

  async process() {
    return this.chairRent.processManualDues();
  }
}
