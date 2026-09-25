import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService } from './barbershop.service';
import { verifyAppointmentToken } from './appointment-link';
import { PLATFORM_SUBSCRIPTION_FEE_PERCENT } from './subscription.constants';
import { reportPeriod, safeTimeZone } from '../common/timezone.util';

const KIND = 'appointment_deposit';

/** Chave do Stripe configurada de verdade (não o exemplo do .env.example) */
export function stripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  return key.startsWith('sk_') && !key.includes('sua_chave');
}

/**
 * Sinal pago online (cartão, Stripe) ao agendar pela página pública, como o
 * "pagamento antecipado" do Booksy. Com a opção ligada na unidade, o horário
 * nasce aguardando pagamento (PENDING_PAYMENT) e fica reservado por alguns
 * minutos; pago, vira confirmado (pela tela ou pelo webhook, o que chegar
 * primeiro — os dois são idempotentes); sem pagar, é liberado. Cancelou pelo
 * link dentro do prazo: o sinal é estornado.
 *
 * O dinheiro entra na conta da plataforma; a taxa da plataforma incide só
 * aqui (pagamento que passa pelo Stripe) e o repasse aparece no relatório.
 */
@Injectable()
export class DepositPaymentService {
  private readonly logger = new Logger(DepositPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly barbershopService: BarbershopService,
  ) {}

  /** Liga/desliga o sinal online da unidade (gerente e dono). */
  async setOnlineDeposit(userId: number, barbershopId: number, enabled: boolean) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    if (enabled && !stripeConfigured()) {
      throw new BadRequestException('Pagamento online indisponível: Stripe não configurado');
    }
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { onlineDeposit: enabled },
    });
    return enabled;
  }

  private async byToken(token: string) {
    const id = verifyAppointmentToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          include: { barbershop: { select: { currency: true, name: true } } },
        })
      : null;
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    return appt;
  }

  /**
   * Começa (ou retoma) o pagamento do sinal: devolve o client secret do
   * PaymentIntent pro cartão ser confirmado na tela. Um PaymentIntent por
   * agendamento (abrir em duas abas não cobra duas vezes).
   */
  async start(token: string) {
    const appt = await this.byToken(token);
    if (appt.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException(
        appt.depositPaid ? 'O sinal já foi pago' : 'Este horário não está aguardando pagamento',
      );
    }
    if (!appt.holdExpiresAt || appt.holdExpiresAt <= new Date()) {
      throw new BadRequestException(
        'O tempo pra pagar acabou e o horário foi liberado. Agende de novo.',
      );
    }
    const amount = Math.round(Number(appt.depositAmount ?? 0) * 100);
    if (amount <= 0) throw new BadRequestException('Este horário não tem sinal');

    let intent: Stripe.PaymentIntent | null = null;
    if (appt.depositPaymentIntentId) {
      intent = await this.stripe.retrievePaymentIntent(appt.depositPaymentIntentId);
      if (intent.status === 'succeeded') {
        await this.finalize(intent);
        throw new BadRequestException('O sinal já foi pago');
      }
      if (intent.status === 'canceled') intent = null;
    }
    if (!intent) {
      const created = await this.stripe.createPaymentIntent(
        amount,
        appt.barbershop.currency.toLowerCase(),
        undefined,
        {
          metadata: { kind: KIND, appointmentId: String(appt.id) },
          description: `Sinal — ${appt.barbershop.name}`,
        },
      );
      // Outra aba criou junto: fica o primeiro gravado, este é cancelado
      const saved = await this.prisma.appointment.updateMany({
        where: { id: appt.id, depositPaymentIntentId: appt.depositPaymentIntentId },
        data: { depositPaymentIntentId: created.id },
      });
      if (saved.count === 0) {
        await this.stripe.cancelPaymentIntent(created.id).catch(() => undefined);
        return this.start(token);
      }
      intent = created;
    }
    return {
      clientSecret: intent.client_secret!,
      amount: amount / 100,
      currency: appt.barbershop.currency,
      holdExpiresAt: appt.holdExpiresAt,
    };
  }

  /** A tela voltou do cartão: confere no Stripe e confirma o horário. */
  async confirm(token: string) {
    const appt = await this.byToken(token);
    if (appt.status === 'CONFIRMED' && appt.depositPaid) return 'CONFIRMED';
    if (!appt.depositPaymentIntentId) {
      throw new BadRequestException('Pagamento não iniciado');
    }
    const intent = await this.stripe.retrievePaymentIntent(appt.depositPaymentIntentId);
    return this.finalize(intent);
  }

  /**
   * Pagamento aprovado (tela, webhook ou a rotina de expiração). Idempotente.
   * Se o horário já tinha sido liberado (pagou depois do prazo), estorna.
   */
  async finalize(intent: Stripe.PaymentIntent): Promise<string> {
    if (intent.status !== 'succeeded') return 'PENDING_PAYMENT';
    const appt = await this.prisma.appointment.findFirst({
      where: {
        OR: [
          { depositPaymentIntentId: intent.id },
          ...(intent.metadata?.appointmentId
            ? [{ id: Number(intent.metadata.appointmentId) }]
            : []),
        ],
      },
      include: { customer: { select: { email: true } } },
    });
    if (!appt) {
      this.logger.warn(`Sinal ${intent.id} pago sem agendamento`);
      return 'NOT_FOUND';
    }
    const confirmed = await this.prisma.appointment.updateMany({
      where: { id: appt.id, status: 'PENDING_PAYMENT' },
      data: {
        status: 'CONFIRMED',
        depositPaid: true,
        depositPaidAt: new Date(),
        depositPaymentIntentId: intent.id,
        holdExpiresAt: null,
      },
    });
    if (confirmed.count === 1) {
      if (appt.customer.email) {
        this.barbershopService
          .notifyAppointmentConfirmed(appt.id, appt.customer.email)
          .catch((err) => this.logger.error(`Erro ao confirmar o agendamento #${appt.id}:`, err));
      }
      return 'CONFIRMED';
    }
    if (appt.status === 'CANCELLED' && !appt.depositPaid) {
      // Pagou depois que o horário foi liberado: devolve o dinheiro (uma vez)
      const claimed = await this.prisma.appointment.updateMany({
        where: { id: appt.id, depositRefundedAt: null },
        data: { depositPaymentIntentId: intent.id, depositRefundedAt: new Date() },
      });
      if (claimed.count === 1) {
        await this.stripe
          .createRefund(
            intent.id,
            undefined,
            'requested_by_customer',
            `deposit-refund-${intent.id}`,
          )
          .catch((err) => this.logger.error(`Erro ao estornar o sinal ${intent.id}:`, err));
      }
      return 'REFUNDED';
    }
    return appt.status;
  }

  /**
   * Rotina: horários aguardando o sinal cujo prazo passou. Se o pagamento
   * foi aprovado nesse meio tempo, confirma; senão, libera o horário.
   */
  async expireHolds(now = new Date()) {
    const due = await this.prisma.appointment.findMany({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: now } },
      select: {
        id: true,
        barbershopId: true,
        barberId: true,
        startAt: true,
        depositPaymentIntentId: true,
        services: { select: { serviceId: true } },
      },
      take: 200,
    });
    let released = 0;
    for (const appt of due) {
      if (appt.depositPaymentIntentId) {
        try {
          const intent = await this.stripe.retrievePaymentIntent(appt.depositPaymentIntentId);
          if (intent.status === 'succeeded') {
            await this.finalize(intent);
            continue;
          }
          if (intent.status !== 'canceled') {
            await this.stripe.cancelPaymentIntent(intent.id).catch(() => undefined);
          }
        } catch (err) {
          // Stripe fora: tenta de novo na próxima (não libera sem saber)
          this.logger.error(`Erro ao conferir o sinal do agendamento #${appt.id}:`, err);
          continue;
        }
      }
      const res = await this.prisma.appointment.updateMany({
        where: { id: appt.id, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', holdExpiresAt: null },
      });
      released += res.count;
      // O horário voltou a ficar livre: pode ser a vaga de alguém da lista de espera
      if (res.count) {
        this.barbershopService
          .checkWaitlistOnCancellation(appt.barbershopId, appt)
          .catch((err) =>
            this.logger.error(`Erro ao verificar lista de espera do agendamento #${appt.id}:`, err),
          );
      }
    }
    if (released) this.logger.log(`Horários liberados sem o sinal: ${released}`);
    return released;
  }

  /**
   * Repasse do sinal online (gerente e dono): quanto os clientes pagaram pelo
   * Stripe no período, a taxa da plataforma (só nesse valor) e o que é devido
   * à unidade. Estornados não contam. Não transfere nada — só calcula.
   */
  async payoutReport(userId: number, barbershopId: number, startDate?: string, endDate?: string) {
    const shop = await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const paid = await this.prisma.appointment.findMany({
      where: {
        barbershopId,
        depositPaid: true,
        depositPaymentIntentId: { not: null },
        depositPaidAt: reportPeriod(safeTimeZone(shop.timezone), startDate, endDate),
      },
      select: { depositAmount: true },
    });
    const grossAmount = paid.reduce((sum, a) => sum + Number(a.depositAmount ?? 0), 0);
    const platformFeeAmount = Math.round(grossAmount * PLATFORM_SUBSCRIPTION_FEE_PERCENT) / 100;
    return {
      paymentsCount: paid.length,
      grossAmount,
      platformFeePercentage: PLATFORM_SUBSCRIPTION_FEE_PERCENT,
      platformFeeAmount,
      netOwedToBarbershop: grossAmount - platformFeeAmount,
    };
  }

  /** Estorno do sinal quando o cliente cancela pelo link, dentro do prazo. */
  refundOnClientCancel(appointmentId: number) {
    return this.barbershopService.refundOnlineDeposit(appointmentId);
  }
}
