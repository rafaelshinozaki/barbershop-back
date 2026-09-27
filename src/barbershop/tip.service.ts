import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, type AccessLevel } from './barbershop.service';

export const TIP_DESTINATIONS = ['professional', 'unit'] as const;
export const TIP_METHODS = ['CASH', 'PIX', 'CARD'] as const;
export type TipDestination = (typeof TIP_DESTINATIONS)[number];
export type TipMethod = (typeof TIP_METHODS)[number];

const MAX_TIP = 10_000;
const DESK_LEVELS: AccessLevel[] = ['reception', 'manager', 'owner'];
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Caixinha do atendimento (item 11 do roadmap), registrada na mão: dinheiro,
 * Pix ou "a mais no cartão" da maquininha. O cliente escolhe o destino, o
 * profissional ou a unidade. Quando é do profissional mas a unidade recebeu
 * (sempre no cartão; no dinheiro e no Pix, se foi no balcão), entra como
 * lançamento TIP no pagamento dele. O dinheiro não passa pela plataforma.
 */
@Injectable()
export class TipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershops: BarbershopService,
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

  /** Registro errado: apaga, junto com o lançamento no pagamento (se ainda não fechado) */
  async remove(userId: number, barbershopId: number, tipId: number) {
    const tip = await this.prisma.appointmentTip.findFirst({
      where: { id: tipId, barbershopId },
      select: { id: true, appointmentId: true, payEntryId: true },
    });
    if (!tip) throw new NotFoundException('Caixinha não encontrada');
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
