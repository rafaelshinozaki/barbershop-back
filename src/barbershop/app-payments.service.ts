import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { currentPricing } from '../pricing/pricing';
import { BarbershopService } from './barbershop.service';

export const APP_PAYMENT_KINDS = ['deposit', 'prepaid', 'tip'] as const;
export type AppPaymentKind = (typeof APP_PAYMENT_KINDS)[number];
export const APP_PAYMENT_STATUSES = ['paid', 'partial', 'refunded', 'disputed'] as const;
export type AppPaymentStatus = (typeof APP_PAYMENT_STATUSES)[number];

export type AppPaymentFilter = {
  kind?: AppPaymentKind | null;
  status?: AppPaymentStatus | null;
  barbershopId?: number | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
};

type Row = {
  kind: AppPaymentKind;
  id: number;
  appointmentId: number;
  barbershopId: number;
  barbershopName: string;
  paidAt: Date;
  amount: Prisma.Decimal | number;
  refundedAmount: Prisma.Decimal | number;
  currency: string;
  paymentIntentId: string;
  disputeStatus: string | null;
  disputeReason: string | null;
};

const ACTIVE_DISPUTE = [
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
];

/**
 * Pagamentos pelo app no backoffice (Financeiro): sinal, atendimento pago
 * antes e caixinha, todos direto na conta da unidade/profissional (Stripe
 * Connect, com a taxa da plataforma). Lista com estorno e disputa, e o
 * estorno pela equipe (com motivo, que vai pro registro de ações).
 */
@Injectable()
export class AppPaymentsService {
  private readonly logger = new Logger(AppPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
    private readonly stripe: StripeService,
  ) {}

  /** As três origens num SELECT só, com a disputa (se houver) */
  private source() {
    return Prisma.sql`
      SELECT 'deposit' AS kind, a.id, a.id AS "appointmentId", b.id AS "barbershopId",
             b.name AS "barbershopName", a."depositPaidAt" AS "paidAt",
             a."depositAmount" AS amount,
             CASE WHEN a."depositRefundedAt" IS NULL THEN 0 ELSE a."depositAmount" END AS "refundedAmount",
             b.currency, a."depositPaymentIntentId" AS "paymentIntentId"
        FROM "Appointment" a JOIN "Barbershop" b ON b.id = a."barbershopId"
       WHERE a."depositPaymentIntentId" IS NOT NULL AND a."depositPaidAt" IS NOT NULL
      UNION ALL
      SELECT 'prepaid', a.id, a.id, b.id, b.name, a."prepaidAt", a."prepaidAmount",
             CASE WHEN a."prepaidRefundedAt" IS NOT NULL THEN a."prepaidAmount"
                  ELSE COALESCE(a."prepaidRefundedAmount", 0) END,
             b.currency, a."prepaidPaymentIntentId"
        FROM "Appointment" a JOIN "Barbershop" b ON b.id = a."barbershopId"
       WHERE a."prepaidPaymentIntentId" IS NOT NULL AND a."prepaidAt" IS NOT NULL
      UNION ALL
      SELECT 'tip', t.id, t."appointmentId", b.id, b.name, t."createdAt", t.amount,
             CASE WHEN t."refundedAt" IS NULL THEN 0 ELSE t.amount END,
             t.currency, t."stripePaymentIntentId"
        FROM "AppointmentTip" t JOIN "Barbershop" b ON b.id = t."barbershopId"
       WHERE t.method = 'STRIPE' AND t."stripePaymentIntentId" IS NOT NULL`;
  }

  async list(filter: AppPaymentFilter) {
    const where: Prisma.Sql[] = [];
    if (filter.kind) where.push(Prisma.sql`p.kind = ${filter.kind}`);
    if (filter.barbershopId) where.push(Prisma.sql`p."barbershopId" = ${filter.barbershopId}`);
    if (filter.from) where.push(Prisma.sql`p."paidAt" >= ${filter.from}`);
    if (filter.to) where.push(Prisma.sql`p."paidAt" < ${filter.to}`);
    const disputed = Prisma.sql`d.status IN (${Prisma.join(ACTIVE_DISPUTE)})`;
    if (filter.status === 'disputed') where.push(disputed);
    if (filter.status === 'refunded') where.push(Prisma.sql`p."refundedAmount" >= p.amount`);
    if (filter.status === 'partial')
      where.push(Prisma.sql`p."refundedAmount" > 0 AND p."refundedAmount" < p.amount`);
    if (filter.status === 'paid') where.push(Prisma.sql`p."refundedAmount" = 0`);
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const from = Prisma.sql`
      FROM (${this.source()}) p
      LEFT JOIN LATERAL (
        SELECT status, reason FROM "PaymentDispute" x
         WHERE x."stripePaymentIntentId" = p."paymentIntentId"
         ORDER BY x."createdAt" DESC LIMIT 1
      ) d ON true
      ${cond}`;
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT p.*, d.status AS "disputeStatus", d.reason AS "disputeReason"
        ${from} ORDER BY p."paidAt" DESC, p.kind, p.id DESC LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<
        { count: bigint; amount: Prisma.Decimal | null; refunded: Prisma.Decimal | null }[]
      >`
        SELECT COUNT(*) AS count, SUM(p.amount) AS amount, SUM(p."refundedAmount") AS refunded ${from}`,
    ]);
    const amount = Number(totals[0]?.amount ?? 0);
    const refunded = Number(totals[0]?.refunded ?? 0);
    return {
      total: Number(totals[0]?.count ?? 0),
      amount,
      refunded,
      // Taxa pela tabela de hoje (a cobrada na hora pode ter sido outra)
      estimatedFee: Math.round((amount - refunded) * currentPricing().platformFeePercent) / 100,
      feePercent: currentPricing().platformFeePercent,
      items: rows.map((r) => {
        const total = Number(r.amount);
        const back = Number(r.refundedAmount);
        const disputed = r.disputeStatus != null && ACTIVE_DISPUTE.includes(r.disputeStatus);
        return {
          kind: r.kind,
          id: r.id,
          appointmentId: r.appointmentId,
          barbershopId: r.barbershopId,
          barbershopName: r.barbershopName,
          paidAt: r.paidAt,
          amount: total,
          refundedAmount: back,
          currency: r.currency,
          status: (disputed
            ? 'disputed'
            : back >= total
            ? 'refunded'
            : back > 0
            ? 'partial'
            : 'paid') as AppPaymentStatus,
          disputeStatus: r.disputeStatus,
          disputeReason: r.disputeReason,
        };
      }),
    };
  }

  /** Quanto o estorno devolve (o pedido, ou o que restar): pro limite sem confirmação */
  async refundValue(kind: AppPaymentKind, id: number, amount?: number | null): Promise<number> {
    if (kind === 'tip') {
      const tip = await this.prisma.appointmentTip.findUnique({ where: { id } });
      if (!tip || tip.method !== 'STRIPE')
        throw new NotFoundException('Caixinha paga pelo app não encontrada');
      return tip.refundedAt ? 0 : Number(tip.amount);
    }
    const appt = await this.prisma.appointment.findUnique({ where: { id } });
    if (!appt) throw new NotFoundException('Pagamento não encontrado');
    if (kind === 'deposit') return appt.depositRefundedAt ? 0 : Number(appt.depositAmount ?? 0);
    const remaining = appt.prepaidRefundedAt
      ? 0
      : Number(appt.prepaidAmount ?? 0) - Number(appt.prepaidRefundedAmount ?? 0);
    return Math.round((amount ?? remaining) * 100) / 100;
  }

  /**
   * Estorno pela equipe do Financeiro. Sinal e caixinha voltam inteiros; o
   * atendimento pago pode voltar em parte. O motivo é obrigatório (vai pro
   * registro de ações junto com a operação).
   */
  async refund(
    kind: AppPaymentKind,
    id: number,
    amount: number | null | undefined,
    reason: string,
  ) {
    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('Informe o motivo do estorno');
    }
    if (kind === 'deposit') {
      if (amount != null) throw new BadRequestException('O sinal volta inteiro');
      const appt = await this.prisma.appointment.findUnique({
        where: { id },
        select: { depositPaidAt: true, depositRefundedAt: true, depositPaymentIntentId: true },
      });
      if (!appt?.depositPaymentIntentId || !appt.depositPaidAt) {
        throw new NotFoundException('Sinal pago pelo app não encontrado');
      }
      if (appt.depositRefundedAt) throw new BadRequestException('O sinal já foi estornado');
      const ok = await this.guard(() => this.barbershops.refundOnlineDeposit(id));
      if (!ok) throw new BadRequestException('O sinal já foi estornado');
      return true;
    }
    if (kind === 'prepaid') {
      const appt = await this.prisma.appointment.findUnique({
        where: { id },
        select: { prepaidAt: true, prepaidRefundedAt: true, sale: { select: { id: true } } },
      });
      if (!appt?.prepaidAt) throw new NotFoundException('Atendimento pago pelo app não encontrado');
      if (appt.prepaidRefundedAt) throw new BadRequestException('O pagamento já foi estornado');
      // Conta fechada já descontou o pagamento: estornar daqui desequilibra o caixa
      if (appt.sale) {
        throw new BadRequestException(
          'A conta deste horário já foi fechada: estorne pelo painel do Stripe',
        );
      }
      const ok = await this.guard(() => this.barbershops.refundPrepayment(id, amount ?? undefined));
      if (!ok) throw new BadRequestException('O pagamento já foi estornado');
      return true;
    }
    if (amount != null) throw new BadRequestException('A caixinha volta inteira');
    return this.refundTip(id);
  }

  private async refundTip(id: number) {
    const tip = await this.prisma.appointmentTip.findUnique({
      where: { id },
      select: { method: true, stripePaymentIntentId: true, refundedAt: true },
    });
    const intentId = tip?.stripePaymentIntentId;
    if (!tip || tip.method !== 'STRIPE' || !intentId) {
      throw new NotFoundException('Caixinha paga pelo app não encontrada');
    }
    const now = new Date();
    // Marca antes (dois cliques não estornam duas vezes); desfaz se a Stripe recusar
    const claimed = await this.prisma.appointmentTip.updateMany({
      where: { id, refundedAt: null },
      data: { refundedAt: now },
    });
    if (claimed.count === 0) throw new BadRequestException('A caixinha já foi estornada');
    await this.guard(async () => {
      try {
        await this.stripe.createRefund(
          intentId,
          undefined,
          'requested_by_customer',
          `tip-refund-${intentId}`,
          true,
        );
      } catch (err) {
        if ((err as { code?: string })?.code === 'charge_already_refunded') return true;
        await this.prisma.appointmentTip.updateMany({
          where: { id, refundedAt: now },
          data: { refundedAt: null },
        });
        throw err;
      }
      return true;
    });
    return true;
  }

  /** Erro da Stripe vira mensagem pra tela (o detalhe vai pro log) */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error('Erro ao estornar pagamento pelo app', err);
      throw new BadRequestException('Não foi possível estornar agora. Tente de novo.');
    }
  }

  /** Webhook charge.dispute.*: guarda (ou atualiza) a disputa */
  async recordDispute(dispute: Stripe.Dispute) {
    const intent =
      typeof dispute.payment_intent === 'string'
        ? dispute.payment_intent
        : dispute.payment_intent?.id ?? null;
    const closed = ['won', 'lost', 'warning_closed'].includes(dispute.status);
    const data = {
      stripePaymentIntentId: intent,
      amountCents: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
      status: dispute.status,
      evidenceDueBy: dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000)
        : null,
      closedAt: closed ? new Date() : null,
    };
    await this.prisma.paymentDispute.upsert({
      where: { stripeDisputeId: dispute.id },
      create: { stripeDisputeId: dispute.id, ...data },
      update: data,
    });
  }
}
