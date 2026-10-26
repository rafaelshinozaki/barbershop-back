import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { currentPricing } from '../pricing/pricing';
import { BarbershopService } from './barbershop.service';
import { fromMinorUnits, toMinorUnits } from '../common/money-units';

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
        {
          currency: string;
          count: bigint;
          amount: Prisma.Decimal | null;
          refunded: Prisma.Decimal | null;
        }[]
      >`
        SELECT p.currency, COUNT(*) AS count, SUM(p.amount) AS amount,
               SUM(p."refundedAmount") AS refunded
        ${from} GROUP BY p.currency ORDER BY p.currency`,
    ]);
    // Cada unidade cobra na moeda dela: somar reais com dólares dava um número
    // sem sentido (item 288). Uma moeda só fica na raiz; várias, só na lista
    const feePercent = currentPricing().platformFeePercent;
    const byCurrency = totals.map((t) => {
      const amount = Number(t.amount ?? 0);
      const refunded = Number(t.refunded ?? 0);
      return {
        currency: t.currency,
        count: Number(t.count),
        amount,
        refunded,
        // Taxa pela tabela de hoje (a cobrada na hora pode ter sido outra)
        estimatedFee: Math.round((amount - refunded) * feePercent) / 100,
      };
    });
    const single = byCurrency.length === 1 ? byCurrency[0] : null;
    return {
      total: byCurrency.reduce((n, g) => n + g.count, 0),
      amount: single?.amount ?? 0,
      refunded: single?.refunded ?? 0,
      estimatedFee: single?.estimatedFee ?? 0,
      feePercent,
      byCurrency,
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

  /** Moeda do pagamento, pro limite de estorno sem confirmação (item 291). */
  async refundCurrency(kind: AppPaymentKind, id: number): Promise<string> {
    if (kind === 'tip') {
      const tip = await this.prisma.appointmentTip.findUnique({
        where: { id },
        select: { currency: true },
      });
      if (!tip) throw new NotFoundException('Caixinha paga pelo app não encontrada');
      return tip.currency;
    }
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      select: { barbershop: { select: { currency: true } } },
    });
    if (!appt) throw new NotFoundException('Pagamento não encontrado');
    return appt.barbershop.currency;
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
   * Quanto já voltou desse pagamento. Só o atendimento pago volta em partes:
   * o limite sem confirmação vale pela soma, senão bastaria estornar em pedaços.
   */
  async refundedSoFar(kind: AppPaymentKind, id: number): Promise<number> {
    if (kind !== 'prepaid') return 0;
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      select: { prepaidRefundedAmount: true },
    });
    return Number(appt?.prepaidRefundedAmount ?? 0);
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
        select: {
          depositPaidAt: true,
          depositRefundedAt: true,
          depositPaymentIntentId: true,
          sale: { select: { id: true } },
        },
      });
      if (!appt?.depositPaymentIntentId || !appt.depositPaidAt) {
        throw new NotFoundException('Sinal pago pelo app não encontrado');
      }
      if (appt.depositRefundedAt) throw new BadRequestException('O sinal já foi estornado');
      if (appt.sale) {
        throw new BadRequestException(
          'A conta deste horário já foi fechada: estorne pelo painel do Stripe',
        );
      }
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

  /**
   * Webhook charge.dispute.*: guarda (ou atualiza) a disputa. Devolve true
   * quando a disputa acabou de ser perdida (quem chama trata como estorno).
   */
  async recordDispute(dispute: Stripe.Dispute): Promise<boolean> {
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
    // A Stripe não garante a ordem dos eventos: disputa já encerrada (ganha,
    // perdida) não volta a ficar aberta por um "updated" que chegou atrasado
    const existing = await this.prisma.paymentDispute.findUnique({
      where: { stripeDisputeId: dispute.id },
      select: { closedAt: true },
    });
    if (existing?.closedAt) return false;
    await this.prisma.paymentDispute.upsert({
      where: { stripeDisputeId: dispute.id },
      create: { stripeDisputeId: dispute.id, ...data },
      update: data,
    });
    // Disputa perdida: o dinheiro voltou ao cliente, como um estorno
    if (dispute.status === 'lost' && intent) await this.revokePlatformPurchase(intent);
    return dispute.status === 'lost';
  }

  /**
   * Disputa perdida vista como estorno da cobrança: o valor disputado voltou
   * ao cliente. Antes só a compra da plataforma era desfeita; clube, sinal e
   * aluguel continuavam como recebidos e entravam no "a repassar". A
   * cobrança vem da Stripe (a fatura liga clube e aluguel); sem ela, só o
   * que se acha pelo pagamento (sinal, atendimento pago, caixinha).
   */
  async chargeOfLostDispute(dispute: Stripe.Dispute): Promise<Stripe.Charge | null> {
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
    let charge: Stripe.Charge | null =
      dispute.charge && typeof dispute.charge !== 'string' ? dispute.charge : null;
    if (!charge && chargeId) {
      charge = await this.stripe.retrieveCharge(chargeId).catch((err) => {
        this.logger.warn(`Cobrança ${chargeId} da disputa ${dispute.id} não encontrada: ${err}`);
        return null;
      });
    }
    const amount = charge?.amount ?? dispute.amount;
    const lost = Math.max(dispute.amount, charge?.amount_refunded ?? 0);
    return {
      ...(charge ?? {}),
      id: charge?.id ?? chargeId ?? dispute.id,
      payment_intent: charge?.payment_intent ?? dispute.payment_intent,
      currency: charge?.currency ?? dispute.currency,
      amount,
      amount_refunded: Math.min(amount, lost),
      refunded: lost >= amount,
    } as Stripe.Charge;
  }

  /**
   * Estorno que nasceu na Stripe (painel ou reembolso que confirmou depois).
   * Marca sinal, atendimento pago e caixinha do mesmo jeito que o estorno
   * feito aqui, sem chamar a Stripe de novo. Evento repetido não desfaz.
   */
  async syncStripeRefund(charge: Stripe.Charge) {
    const paymentIntentId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null;
    // Na moeda da cobrança (a Stripe manda na menor unidade: centavo, ou a
    // própria unidade nas moedas sem centavos)
    const refunded = fromMinorUnits(charge.amount_refunded ?? 0, charge.currency);
    if (refunded > 0) await this.syncClubPaymentRefund(charge, refunded);
    if (!paymentIntentId || refunded <= 0) return;
    const now = new Date();
    const currency = charge.currency;
    await this.syncDepositRefund(paymentIntentId, refunded, currency, charge.refunded, now);
    await this.syncPrepaidRefund(paymentIntentId, refunded, charge.refunded, now);
    await this.syncTipRefund(paymentIntentId, refunded, currency, charge.refunded, now);
    // Compra da plataforma (Destaque, taxa da vaga): só o estorno total desfaz
    if (charge.refunded) await this.revokePlatformPurchase(paymentIntentId, now);
  }

  /**
   * Fatura do clube estornada (resto do ciclo ao encerrar a unidade, ou pelo
   * painel do Stripe): grava o total devolvido, que sai do repasse. Só sobe:
   * evento atrasado com valor menor não desfaz.
   */
  private async syncClubPaymentRefund(charge: Stripe.Charge, refunded: number) {
    const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id;
    if (!invoiceId) return;
    await this.prisma.clientSubscriptionPayment.updateMany({
      where: {
        stripeInvoiceId: invoiceId,
        OR: [{ refundedAmount: null }, { refundedAmount: { lt: refunded } }],
      },
      data: { refundedAmount: refunded },
    });
  }

  /**
   * Destaque ou taxa da vaga estornados (ou disputa perdida): a compra deixa
   * de valer. O Destaque perde os dias que ela tinha somado (o que já passou
   * não volta; termina agora, no máximo) e a taxa da vaga deixa de contar
   * como paga. Antes os dois continuavam valendo depois do estorno.
   */
  async revokePlatformPurchase(paymentIntentId: string, now = new Date()) {
    const purchase = await this.prisma.featuredPurchase.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, status: true, ownerType: true, ownerId: true, days: true },
    });
    if (purchase?.status === 'paid') {
      const claimed = await this.prisma.featuredPurchase.updateMany({
        where: { id: purchase.id, status: 'paid' },
        data: { status: 'refunded' },
      });
      if (claimed.count > 0) {
        const table = purchase.ownerType === 'barbershop' ? '"Barbershop"' : '"Professional"';
        await this.prisma.$executeRawUnsafe(
          `UPDATE ${table}
              SET "featuredUntil" = LEAST("featuredUntil",
                    GREATEST("featuredUntil" - ($1 || ' days')::interval, $3::timestamp))
            WHERE id = $2 AND "featuredUntil" IS NOT NULL`,
          String(purchase.days),
          purchase.ownerId,
          now,
        );
        this.logger.warn(`Destaque #${purchase.id} estornado: os dias da compra saíram`);
      }
    }
    const fee = await this.prisma.jobApplication.updateMany({
      where: { feePaymentIntentId: paymentIntentId, feePaidAt: { not: null }, feeRefundedAt: null },
      // Sem o id do pagamento, o mesmo pagamento repetido não volta a valer
      // (como na taxa devolvida quando o aceite falha)
      data: { feePaidAt: null, feeRefundedAt: now, feePaymentIntentId: null },
    });
    if (fee.count > 0) {
      this.logger.warn(`Taxa da vaga estornada (pagamento ${paymentIntentId})`);
    }
  }

  private async syncDepositRefund(
    paymentIntentId: string,
    refunded: number,
    currency: string,
    fullyRefunded: boolean,
    now: Date,
  ) {
    const appt = await this.prisma.appointment.findFirst({
      where: { depositPaymentIntentId: paymentIntentId },
      select: { id: true, depositAmount: true, depositRefundedAt: true },
    });
    if (!appt || appt.depositRefundedAt) return;
    const deposit = toMinorUnits(Number(appt.depositAmount ?? 0), currency);
    if (!fullyRefunded && toMinorUnits(refunded, currency) < deposit) return;
    await this.prisma.appointment.updateMany({
      where: { id: appt.id, depositRefundedAt: null },
      data: { depositPaid: false, depositRefundedAt: now },
    });
  }

  private async syncPrepaidRefund(
    paymentIntentId: string,
    refunded: number,
    fullyRefunded: boolean,
    now: Date,
  ) {
    const appt = await this.prisma.appointment.findFirst({
      where: { prepaidPaymentIntentId: paymentIntentId },
      select: {
        id: true,
        prepaidAt: true,
        prepaidAmount: true,
        prepaidRefundedAt: true,
        prepaidRefundedAmount: true,
      },
    });
    if (!appt?.prepaidAt || appt.prepaidRefundedAt) return;
    const paid = Number(appt.prepaidAmount ?? 0);
    const before = Number(appt.prepaidRefundedAmount ?? 0);
    const fromStripe = refunded;
    const next = Math.min(paid, Math.max(before, fromStripe));
    const full = fullyRefunded || (paid > 0 && next >= paid);
    if (next === before && !full) return;
    await this.prisma.appointment.updateMany({
      where: { id: appt.id, prepaidRefundedAt: null },
      data: { prepaidRefundedAmount: next, prepaidRefundedAt: full ? now : null },
    });
  }

  private async syncTipRefund(
    paymentIntentId: string,
    refunded: number,
    currency: string,
    fullyRefunded: boolean,
    now: Date,
  ) {
    const tip = await this.prisma.appointmentTip.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true, amount: true, refundedAt: true },
    });
    if (!tip || tip.refundedAt) return;
    const tipMinor = toMinorUnits(Number(tip.amount), currency);
    if (!fullyRefunded && toMinorUnits(refunded, currency) < tipMinor) return;
    await this.prisma.appointmentTip.updateMany({
      where: { id: tip.id, refundedAt: null },
      data: { refundedAt: now },
    });
  }
}
