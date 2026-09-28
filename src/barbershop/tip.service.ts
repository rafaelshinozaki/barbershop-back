import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { BarbershopService, type AccessLevel } from './barbershop.service';
import { ConnectService, platformFeeCents } from './connect.service';
import { verifyReviewToken } from './appointment-link';

export const TIP_DESTINATIONS = ['professional', 'unit'] as const;
export const TIP_METHODS = ['CASH', 'PIX', 'CARD'] as const;
export type TipDestination = (typeof TIP_DESTINATIONS)[number];
export type TipMethod = (typeof TIP_METHODS)[number];

const MAX_TIP = 10_000;
/** Caixinha pelo app: de 1 a 500 na moeda da unidade */
const MIN_APP_TIP = 1;
const MAX_APP_TIP = 500;
const TIP_KIND = 'appointment_tip';
const DESK_LEVELS: AccessLevel[] = ['reception', 'manager', 'owner'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Caixinha do atendimento (item 11 do roadmap), registrada na mão: dinheiro,
 * Pix ou "a mais no cartão" da maquininha. O cliente escolhe o destino, o
 * profissional ou a unidade. Quando é do profissional mas a unidade recebeu
 * (sempre no cartão; no dinheiro e no Pix, se foi no balcão), entra como
 * lançamento TIP no pagamento dele. O dinheiro não passa pela plataforma.
 *
 * Pelo app: o cliente dá a caixinha no link "como foi?" do e-mail, com
 * cartão, pra quem tiver conta de recebimento ativa (Stripe Connect). O
 * valor cai direto na conta de quem recebe, já sem a taxa da plataforma, e
 * entra aqui como caixinha STRIPE (não passa pelo pagamento do profissional).
 */
@Injectable()
export class TipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
    private readonly stripe: StripeService,
    private readonly connect: ConnectService,
  ) {}

  async list(userId: number, barbershopId: number, appointmentId: number) {
    const appt = await this.loadAppointment(barbershopId, appointmentId);
    await this.ensureCanManage(userId, appt);
    const tips = await this.prisma.appointmentTip.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'asc' },
      include: { barber: { select: { name: true } } },
    });
    const entries = await this.prisma.barberPayEntry.findMany({
      where: { id: { in: tips.map((t) => t.payEntryId).filter((id): id is number => id != null) } },
      select: { id: true, payoutId: true },
    });
    return tips.map((t) => this.view(t, entries.find((e) => e.id === t.payEntryId)?.payoutId));
  }

  async add(
    userId: number,
    barbershopId: number,
    appointmentId: number,
    input: {
      destination: string;
      method: string;
      amount: number;
      receivedByUnit?: boolean | null;
    },
  ) {
    if (!(TIP_DESTINATIONS as readonly string[]).includes(input.destination)) {
      throw new BadRequestException('Destino da caixinha inválido');
    }
    if (!(TIP_METHODS as readonly string[]).includes(input.method)) {
      throw new BadRequestException('Forma da caixinha inválida');
    }
    if (!(input.amount > 0) || input.amount > MAX_TIP) {
      throw new BadRequestException('Valor da caixinha inválido');
    }
    const appt = await this.loadAppointment(barbershopId, appointmentId);
    if (appt.status !== 'COMPLETED') {
      throw new BadRequestException('Só dá pra registrar caixinha de atendimento concluído');
    }
    await this.ensureCanManage(userId, appt);
    const destination = input.destination as TipDestination;
    const method = input.method as TipMethod;
    if (destination === 'unit' && appt.barbershop.practiceKind === 'solo') {
      throw new BadRequestException('No modo solo a caixinha é do profissional');
    }
    // A mais no cartão cai sempre na maquininha da unidade
    const receivedByUnit =
      destination === 'professional' && (method === 'CARD' || Boolean(input.receivedByUnit));
    const amount = new Decimal(round2(input.amount));

    const tip = await this.prisma.$transaction(async (tx) => {
      let payEntryId: number | null = null;
      if (receivedByUnit) {
        const entry = await tx.barberPayEntry.create({
          data: {
            barbershopId,
            barberId: appt.barberId,
            type: 'TIP',
            amount,
            method,
            date: appt.startAt,
            notes: `Caixinha — ${appt.customer.name.split(' ')[0]}`,
            createdByUserId: userId,
          },
          select: { id: true },
        });
        payEntryId = entry.id;
      }
      return tx.appointmentTip.create({
        data: {
          appointmentId,
          barbershopId,
          barberId: destination === 'professional' ? appt.barberId : null,
          destination,
          method,
          amount,
          currency: appt.barbershop.currency,
          receivedByUnit,
          payEntryId,
          createdByUserId: userId,
        },
        include: { barber: { select: { name: true } } },
      });
    });
    return this.view(tip, null);
  }

  // ---- caixinha pelo app (cliente, pelo link do e-mail) ----

  private async appointmentByToken(token: string) {
    const id = verifyReviewToken(token);
    const appt = id
      ? await this.prisma.appointment.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            barbershopId: true,
            barberId: true,
            barber: { select: { name: true, professionalId: true } },
            barbershop: { select: { name: true, currency: true, practiceKind: true } },
          },
        })
      : null;
    if (!appt || appt.status !== 'COMPLETED') {
      throw new NotFoundException('Link inválido ou atendimento não encontrado');
    }
    return appt;
  }

  /** Pra onde vai a caixinha de cada destino (null = não recebe pelo app) */
  private async destinations(appt: Awaited<ReturnType<TipService['appointmentByToken']>>) {
    const professional = appt.barber.professionalId
      ? await this.connect.destination('professional', appt.barber.professionalId)
      : null;
    const unit =
      appt.barbershop.practiceKind === 'solo'
        ? null
        : await this.connect.destination('barbershop', appt.barbershopId);
    return { professional, unit };
  }

  /** Página do link: quem recebe caixinha pelo app e as que o cliente já deu */
  async appTipOptions(token: string) {
    const appt = await this.appointmentByToken(token);
    const dest = await this.destinations(appt);
    const given = await this.prisma.appointmentTip.findMany({
      where: { appointmentId: appt.id, method: 'STRIPE' },
      orderBy: { createdAt: 'asc' },
      select: { destination: true, amount: true },
    });
    return {
      currency: appt.barbershop.currency,
      professionalName: appt.barber.name,
      barbershopName: appt.barbershop.name,
      professional: !!dest.professional,
      unit: !!dest.unit,
      minAmount: MIN_APP_TIP,
      maxAmount: MAX_APP_TIP,
      given: given.map((g) => ({ destination: g.destination, amount: Number(g.amount) })),
    };
  }

  /** Começa o pagamento: devolve o client secret pro cartão ser confirmado na tela */
  async startAppTip(token: string, destination: string, amount: number) {
    if (!(TIP_DESTINATIONS as readonly string[]).includes(destination)) {
      throw new BadRequestException('Destino da caixinha inválido');
    }
    if (!(amount >= MIN_APP_TIP) || amount > MAX_APP_TIP) {
      throw new BadRequestException(`A caixinha pelo app vai de ${MIN_APP_TIP} a ${MAX_APP_TIP}`);
    }
    const appt = await this.appointmentByToken(token);
    const accountId = (await this.destinations(appt))[destination as TipDestination];
    if (!accountId) {
      throw new BadRequestException('Este destino ainda não recebe caixinha pelo app');
    }
    const cents = Math.round(round2(amount) * 100);
    const intent = await this.stripe.createPaymentIntent(
      cents,
      appt.barbershop.currency.toLowerCase(),
      undefined,
      {
        metadata: {
          kind: TIP_KIND,
          appointmentId: String(appt.id),
          destination,
        },
        description: `Caixinha — ${
          destination === 'professional' ? appt.barber.name : appt.barbershop.name
        }`,
        destination: { accountId, applicationFeeAmount: platformFeeCents(cents) },
      },
    );
    return {
      clientSecret: intent.client_secret!,
      paymentIntentId: intent.id,
      amount: cents / 100,
      currency: appt.barbershop.currency,
    };
  }

  /** A tela voltou do cartão: confere no Stripe e registra (idempotente) */
  async confirmAppTip(token: string, paymentIntentId: string) {
    const appt = await this.appointmentByToken(token);
    const intent = await this.stripe.retrievePaymentIntent(paymentIntentId);
    if (intent.metadata?.kind !== TIP_KIND || intent.metadata?.appointmentId !== String(appt.id)) {
      throw new BadRequestException('Pagamento não é desta caixinha');
    }
    return this.finalizeAppTip(intent);
  }

  /** Pagamento aprovado (tela ou webhook): registra a caixinha uma vez só */
  async finalizeAppTip(intent: Stripe.PaymentIntent): Promise<boolean> {
    if (intent.status !== 'succeeded') return false;
    const appointmentId = Number(intent.metadata?.appointmentId);
    const destination = intent.metadata?.destination as TipDestination;
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        barbershopId: true,
        barberId: true,
        barbershop: { select: { currency: true } },
      },
    });
    if (!appt || !(TIP_DESTINATIONS as readonly string[]).includes(destination)) return false;
    try {
      await this.prisma.appointmentTip.create({
        data: {
          appointmentId: appt.id,
          barbershopId: appt.barbershopId,
          barberId: destination === 'professional' ? appt.barberId : null,
          destination,
          method: 'STRIPE',
          amount: new Decimal(intent.amount / 100),
          currency: appt.barbershop.currency,
          receivedByUnit: false,
          stripePaymentIntentId: intent.id,
        },
      });
    } catch (err) {
      // Tela e webhook chegaram juntos: já registrada
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    return true;
  }

  /** Registro errado: apaga, junto com o lançamento no pagamento (se ainda não fechado) */
  async remove(userId: number, barbershopId: number, tipId: number) {
    const tip = await this.prisma.appointmentTip.findFirst({
      where: { id: tipId, barbershopId },
      select: { id: true, appointmentId: true, payEntryId: true, method: true },
    });
    if (!tip) throw new NotFoundException('Caixinha não encontrada');
    if (tip.method === 'STRIPE') {
      throw new BadRequestException(
        'Caixinha paga pelo app não se apaga aqui: o estorno é pelo painel do Stripe',
      );
    }
    const appt = await this.loadAppointment(barbershopId, tip.appointmentId);
    await this.ensureCanManage(userId, appt);
    if (tip.payEntryId != null) {
      const entry = await this.prisma.barberPayEntry.findUnique({
        where: { id: tip.payEntryId },
        select: { payoutId: true },
      });
      if (entry?.payoutId != null) {
        throw new BadRequestException(
          'Essa caixinha já entrou num pagamento do profissional; não dá pra apagar',
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.appointmentTip.delete({ where: { id: tip.id } }),
      ...(tip.payEntryId != null
        ? [this.prisma.barberPayEntry.deleteMany({ where: { id: tip.payEntryId } })]
        : []),
    ]);
    return true;
  }

  private view(
    tip: {
      id: number;
      createdAt: Date;
      destination: string;
      method: string;
      amount: Decimal;
      currency: string;
      receivedByUnit: boolean;
      barber: { name: string } | null;
    },
    payoutId: number | null | undefined,
  ) {
    return {
      id: tip.id,
      createdAt: tip.createdAt,
      destination: tip.destination,
      method: tip.method,
      amount: Number(tip.amount),
      currency: tip.currency,
      receivedByUnit: tip.receivedByUnit,
      barberName: tip.barber?.name ?? null,
      paidOut: payoutId != null,
    };
  }

  private async loadAppointment(barbershopId: number, appointmentId: number) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      select: {
        id: true,
        status: true,
        startAt: true,
        barberId: true,
        barber: { select: { userId: true } },
        customer: { select: { name: true } },
        barbershop: { select: { id: true, currency: true, practiceKind: true } },
      },
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    return appt;
  }

  /** Recepção pra cima, ou o profissional que atendeu */
  private async ensureCanManage(
    userId: number,
    appt: { barber: { userId: number | null }; barbershop: { id: number } },
  ) {
    if (appt.barber.userId === userId) return;
    const level = await this.barbershops.getMyAccessLevel(userId, appt.barbershop.id);
    if (!level || !DESK_LEVELS.includes(level)) {
      throw new ForbiddenException('Você não pode registrar caixinha deste atendimento');
    }
  }
}
