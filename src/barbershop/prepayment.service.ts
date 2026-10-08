import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService } from './barbershop.service';
import { ConnectService, platformFeeCents } from './connect.service';
import { appointmentLinkCovers, verifyAppointmentToken } from './appointment-link';
import { stripeConfigured } from './stripe-configured';

const KIND = 'appointment_prepayment';
/** Dá pra pagar antes enquanto o horário está marcado e ainda não foi cobrado */
const PAYABLE = ['CONFIRMED', 'IN_PROGRESS'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pagar o atendimento pelo app (Stripe Connect): pelo link "gerenciar
 * agendamento", o cliente paga o preço dos serviços menos o sinal já pago,
 * direto na conta de recebimento da unidade (com a taxa da plataforma).
 * Só aparece com a conta da unidade ativa. Ao fechar a conta, o valor é
 * descontado; se o horário for cancelado (pelo cliente ou pela unidade),
 * volta inteiro (o sinal segue a regra dele).
 */
@Injectable()
export class PrepaymentService {
  private readonly logger = new Logger(PrepaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly barbershops: BarbershopService,
    private readonly connect: ConnectService,
  ) {}

  private async byToken(token: string) {
    const id = verifyAppointmentToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: {
            services: true,
            barbershop: { select: { name: true, currency: true } },
            sale: { select: { id: true } },
          },
        })
      : null;
    if (!appt || !appointmentLinkCovers(token, 'appointment-manage', appt)) {
      throw new NotFoundException('Agendamento não encontrado');
    }
    return appt;
  }

  /** Preço dos serviços menos o sinal já pago */
  private due(appt: Awaited<ReturnType<PrepaymentService['byToken']>>) {
    const price = appt.services.reduce(
      (sum, s) => sum + Number(s.unitPrice) * (s.quantity ?? 1),
      0,
    );
    const deposit = appt.depositPaid ? Number(appt.depositAmount ?? 0) : 0;
    return Math.max(0, round2(price - deposit));
  }

  /** O que a página do link mostra: dá pra pagar pelo app? já pagou? */
  async status(token: string) {
    const appt = await this.byToken(token);
    const paid = !!appt.prepaidAt && !appt.prepaidRefundedAt;
    const refundedAmount = Number(appt.prepaidRefundedAmount ?? 0);
    const amount = this.due(appt);
    const open = PAYABLE.includes(appt.status) && !appt.sale && !appt.prepaidAt;
    const available =
      open &&
      amount > 0 &&
      stripeConfigured() &&
      !!(await this.connect.barbershopDestination(appt.barbershopId));
    return {
      available,
      amount,
      currency: appt.barbershop.currency,
      paid,
      // Já descontado o que foi devolvido em estorno parcial
      paidAmount: paid ? Number(appt.prepaidAmount) - refundedAmount : null,
      refunded: !!appt.prepaidRefundedAt,
      refundedAmount,
    };
  }

  /** Começa (ou retoma) o pagamento: client secret pro cartão na tela */
  async start(token: string) {
    const appt = await this.byToken(token);
    if (appt.prepaidAt) throw new BadRequestException('Este atendimento já foi pago pelo app');
    if (!PAYABLE.includes(appt.status) || appt.sale) {
      throw new BadRequestException('Este horário não pode ser pago agora');
    }
    const amount = this.due(appt);
    const cents = Math.round(amount * 100);
    if (cents <= 0) throw new BadRequestException('Não há valor a pagar');
    if (!stripeConfigured()) throw new BadRequestException('Pagamento online indisponível');
    const destination = await this.connect.barbershopDestination(appt.barbershopId);
    if (!destination) throw new BadRequestException('Esta unidade não recebe pelo app');

    // Um pagamento por horário: abrir em duas abas não cobra duas vezes
    if (appt.prepaidPaymentIntentId) {
      const existing = await this.stripe.retrievePaymentIntent(appt.prepaidPaymentIntentId);
      if (existing.status === 'succeeded') {
        await this.finalize(existing);
        throw new BadRequestException('Este atendimento já foi pago pelo app');
      }
      if (existing.status !== 'canceled' && existing.amount === cents) {
        return {
          clientSecret: existing.client_secret,
          amount,
          currency: appt.barbershop.currency,
        };
      }
      if (existing.status !== 'canceled') {
        await this.stripe.cancelPaymentIntent(existing.id).catch(() => undefined);
      }
    }
    const intent = await this.stripe.createPaymentIntent(
      cents,
      appt.barbershop.currency.toLowerCase(),
      undefined,
      {
        metadata: { kind: KIND, appointmentId: String(appt.id) },
        description: `Atendimento — ${appt.barbershop.name}`,
        destination: { accountId: destination, applicationFeeAmount: platformFeeCents(cents) },
      },
    );
    const saved = await this.prisma.appointment.updateMany({
      where: {
        id: appt.id,
        prepaidAt: null,
        prepaidPaymentIntentId: appt.prepaidPaymentIntentId,
      },
      data: { prepaidPaymentIntentId: intent.id },
    });
    if (saved.count === 0) {
      // Outra aba criou junto: fica a primeira
      await this.stripe.cancelPaymentIntent(intent.id).catch(() => undefined);
      return this.start(token);
    }
    return { clientSecret: intent.client_secret, amount, currency: appt.barbershop.currency };
  }

  /** A tela voltou do cartão: confere no Stripe e registra */
  async confirm(token: string) {
    const appt = await this.byToken(token);
    if (appt.prepaidAt) return true;
    if (!appt.prepaidPaymentIntentId) throw new BadRequestException('Pagamento não iniciado');
    return this.finalize(await this.stripe.retrievePaymentIntent(appt.prepaidPaymentIntentId));
  }

  /**
   * Segundo pagamento aprovado pro mesmo atendimento (o primeiro já vale):
   * devolve inteiro, com o repasse e a taxa. Antes ficava cobrado e sem
   * registro. Chave fixa: tela e webhook juntos estornam uma vez só
   */
  private async refundExtra(intent: Stripe.PaymentIntent) {
    this.logger.warn(`Pagamento ${intent.id} a mais no atendimento; estornando`);
    await this.stripe
      .createRefund(intent.id, undefined, 'duplicate', `prepaid-extra:${intent.id}`, true)
      .catch((err) => this.logger.error(`Erro ao estornar o pagamento a mais ${intent.id}:`, err));
    return false;
  }

  /** Pagamento aprovado (tela ou webhook). Idempotente; cancelado no meio, estorna */
  async finalize(intent: Stripe.PaymentIntent): Promise<boolean> {
    if (intent.status !== 'succeeded') return false;
    const appointmentId = Number(intent.metadata?.appointmentId);
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { id: true, status: true, prepaidAt: true, prepaidPaymentIntentId: true },
    });
    if (!appt) {
      this.logger.warn(`Pagamento ${intent.id} sem agendamento`);
      return false;
    }
    if (appt.prepaidAt) {
      if (appt.prepaidPaymentIntentId === intent.id) return true;
      return this.refundExtra(intent);
    }
    const recorded = await this.prisma.appointment.updateMany({
      where: { id: appt.id, prepaidAt: null },
      data: {
        prepaidAt: new Date(),
        prepaidAmount: intent.amount / 100,
        prepaidPaymentIntentId: intent.id,
        prepaidStripeAccountId: (intent.transfer_data?.destination as string) ?? null,
      },
    });
    if (recorded.count === 0) {
      // Outro pagamento do mesmo atendimento chegou antes (duas abas, valor
      // mudou no meio): este é cobrança a mais
      const now = await this.prisma.appointment.findUnique({
        where: { id: appt.id },
        select: { prepaidPaymentIntentId: true },
      });
      return now?.prepaidPaymentIntentId === intent.id || this.refundExtra(intent);
    }
    // Pagou depois de o horário ser cancelado: devolve na hora
    if (appt.status === 'CANCELLED') {
      await this.barbershops
        .refundPrepayment(appt.id)
        .catch((err) => this.logger.error(`Erro ao estornar o pagamento ${intent.id}:`, err));
    }
    return true;
  }
}
