import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysStr,
  nextDateStr,
  safeTimeZone,
  toZonedParts,
  zonedTimeToUtc,
} from '../common/timezone.util';
import { BarbershopService } from './barbershop.service';
import { DepositPaymentService } from './deposit-payment.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Um fechamento cobre no máximo 60 dias (férias coletivas, reforma)
const MAX_DAYS = 60;

export type ClosureInput = {
  date: string;
  /** Último dia (inclusive), pra fechar vários dias de uma vez */
  endDate?: string | null;
  /** Horário especial; sem os dois = fechado o dia todo */
  openTime?: string | null;
  closeTime?: string | null;
  reason?: string | null;
};

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * O fechamento pega este horário. Confirmado que já começou fica: não
 * cancela (nem estorna) o que já aconteceu. Reserva de sinal entra mesmo
 * que o horário já tenha passado, pra não dar pra pagar um dia fechado.
 */
export function closureAffectsAppointment(
  status: 'CONFIRMED' | 'PENDING_PAYMENT',
  startAt: Date,
  endAt: Date,
  now: Date,
  timeZone: string,
  openTime: string | null,
  closeTime: string | null,
) {
  if (status === 'CONFIRMED' && startAt.getTime() < now.getTime()) return false;
  if (!openTime || !closeTime) return true;
  const start = toZonedParts(startAt, timeZone);
  const end = toZonedParts(endAt, timeZone);
  const endMin = end.dateStr === start.dateStr ? end.minutesOfDay : 24 * 60;
  return start.minutesOfDay < toMinutes(openTime) || endMin > toMinutes(closeTime);
}

/**
 * Feriados e fechamentos da unidade: dia fechado ou com horário especial.
 * A página pública deixa de oferecer esses horários (ver
 * BarbershopService.getWorkingWindowOn); aqui a equipe cadastra, vê quem
 * já estava agendado e, se quiser, cancela avisando o cliente com o motivo.
 */
@Injectable()
export class ClosureService {
  private readonly logger = new Logger(ClosureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
    private readonly deposits: DepositPaymentService,
  ) {}

  private async shopTimeZone(barbershopId: number) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    return safeTimeZone(shop?.timezone);
  }

  /** Valida e devolve os dias (YYYY-MM-DD) do fechamento. */
  private parse(input: ClosureInput, today: string) {
    const valid = (d: string) => DATE.test(d) && !isNaN(Date.parse(`${d}T00:00:00Z`));
    if (!valid(input.date)) throw new BadRequestException('Data inválida');
    if (input.date < today) throw new BadRequestException('Não dá pra fechar um dia que já passou');
    const end = input.endDate || input.date;
    if (!valid(end) || end < input.date) throw new BadRequestException('Data final inválida');
    const dates: string[] = [];
    for (let d = input.date; d <= end; d = nextDateStr(d)) {
      dates.push(d);
      if (dates.length > MAX_DAYS) {
        throw new BadRequestException(`No máximo ${MAX_DAYS} dias por vez`);
      }
    }
    const { openTime, closeTime } = input;
    if (!!openTime !== !!closeTime) {
      throw new BadRequestException('Informe a abertura e o fechamento do horário especial');
    }
    if (openTime && closeTime) {
      if (!TIME.test(openTime) || !TIME.test(closeTime) || openTime >= closeTime) {
        throw new BadRequestException('Horário especial inválido');
      }
    }
    const reason = input.reason?.trim().slice(0, 120) || null;
    return {
      dates,
      openTime: openTime || null,
      closeTime: closeTime || null,
      reason,
    };
  }

  /** Agendamentos confirmados que ficam fora do horário nesses dias. */
  private async affected(
    barbershopId: number,
    timeZone: string,
    dates: string[],
    openTime: string | null,
    closeTime: string | null,
  ) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        barbershopId,
        status: 'CONFIRMED',
        startAt: {
          gte: zonedTimeToUtc(dates[0], 0, timeZone),
          lt: zonedTimeToUtc(nextDateStr(dates[dates.length - 1]), 0, timeZone),
        },
      },
      include: {
        customer: { select: { name: true, email: true } },
        barber: { select: { name: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    const now = new Date();
    return appts.filter((a) =>
      closureAffectsAppointment('CONFIRMED', a.startAt, a.endAt, now, timeZone, openTime, closeTime),
    );
  }

  /** Reservas de sinal que ficaram num horário que não existe mais. */
  private async held(
    barbershopId: number,
    timeZone: string,
    dates: string[],
    openTime: string | null,
    closeTime: string | null,
  ) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        barbershopId,
        status: 'PENDING_PAYMENT',
        startAt: {
          gte: zonedTimeToUtc(dates[0], 0, timeZone),
          lt: zonedTimeToUtc(nextDateStr(dates[dates.length - 1]), 0, timeZone),
        },
      },
      select: { id: true, startAt: true, endAt: true },
    });
    const now = new Date();
    return appts.filter((a) =>
      closureAffectsAppointment(
        'PENDING_PAYMENT',
        a.startAt,
        a.endAt,
        now,
        timeZone,
        openTime,
        closeTime,
      ),
    );
  }

  async list(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    const today = toZonedParts(new Date(), await this.shopTimeZone(barbershopId)).dateStr;
    return this.prisma.barbershopClosure.findMany({
      where: { barbershopId, date: { gte: today } },
      orderBy: { date: 'asc' },
      take: 366,
    });
  }

  /** Antes de confirmar: quem já está agendado e seria afetado. */
  async impact(userId: number, barbershopId: number, input: ClosureInput) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const timeZone = await this.shopTimeZone(barbershopId);
    const { dates, openTime, closeTime } = this.parse(
      input,
      toZonedParts(new Date(), timeZone).dateStr,
    );
    const appts = await this.affected(barbershopId, timeZone, dates, openTime, closeTime);
    return appts.map((a) => ({
      id: a.id,
      startAt: a.startAt,
      customerName: a.customer.name,
      barberName: a.barber.name,
      hasEmail: Boolean(a.customer.email),
    }));
  }

  /**
   * Cadastra (ou troca) o fechamento dos dias. Com cancelAffected, cancela
   * os agendamentos que ficaram fora do horário e avisa cada cliente por
   * e-mail com o motivo.
   */
  async set(
    userId: number,
    barbershopId: number,
    input: ClosureInput & { cancelAffected?: boolean | null },
  ) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const timeZone = await this.shopTimeZone(barbershopId);
    const { dates, openTime, closeTime, reason } = this.parse(
      input,
      toZonedParts(new Date(), timeZone).dateStr,
    );
    // Horário que aumentou (fechado o dia → horário especial, ou janela maior)
    // avisa a lista de espera. Fechar mais não abre vaga, então não avisa.
    await this.barbershopService.withWaitlistOpening(
      barbershopId,
      { from: dates[0], to: dates[dates.length - 1] },
      () =>
        this.prisma.$transaction(
          dates.map((date) =>
            this.prisma.barbershopClosure.upsert({
              where: { barbershopId_date: { barbershopId, date } },
              create: { barbershopId, date, openTime, closeTime, reason, createdByUserId: userId },
              update: { openTime, closeTime, reason, createdByUserId: userId },
            }),
          ),
        ),
    );
    const holds = await this.held(barbershopId, timeZone, dates, openTime, closeTime);
    for (const hold of holds) {
      await this.deposits.releaseUnpaidHold(hold.id, false).catch((err) =>
        this.logger.error(`Erro ao liberar a reserva de sinal #${hold.id}:`, err),
      );
    }
    const affected = await this.affected(barbershopId, timeZone, dates, openTime, closeTime);
    let cancelled = 0;
    if (input.cancelAffected) {
      for (const a of affected) {
        // Condicional: não passa por cima de quem mudou no meio tempo
        const res = await this.prisma.appointment.updateMany({
          where: { id: a.id, status: 'CONFIRMED' },
          data: { status: 'CANCELLED', linkVersion: { increment: 1 } },
        });
        if (res.count === 0) continue;
        cancelled++;
        // A unidade fechou: o sinal pago online volta pro cliente. (Lista de
        // espera não: com a unidade fechada, esse horário não existe mais.)
        await this.barbershopService
          .refundOnlineDeposit(a.id)
          .catch((err) => this.logger.error(`Erro ao estornar o sinal #${a.id}:`, err));
        await this.barbershopService
          .refundPrepayment(a.id)
          .catch((err) => this.logger.error(`Erro ao estornar o pagamento #${a.id}:`, err));
        if (a.customer.email) {
          this.barbershopService
            .notifyAppointmentCancelled(a.id, a.customer.email, reason)
            .catch((err) =>
              this.logger.error(`Erro ao avisar cancelamento do agendamento #${a.id}:`, err),
            );
        }
      }
    }
    return { dates, affectedCount: affected.length, cancelledCount: cancelled };
  }

  async remove(userId: number, barbershopId: number, date: string) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    // Dia reaberto: avisa quem está na lista de espera dele
    await this.barbershopService.withWaitlistOpening(barbershopId, { from: date, to: date }, () =>
      this.prisma.barbershopClosure.deleteMany({ where: { barbershopId, date } }),
    );
    return true;
  }

  /** Próximos fechamentos pra página pública ("Fechado em 25/12 — Natal"). */
  async upcomingPublic(barbershopId: number, timeZone?: string | null, days = 60) {
    const today = toZonedParts(new Date(), safeTimeZone(timeZone)).dateStr;
    return this.prisma.barbershopClosure.findMany({
      where: { barbershopId, date: { gte: today, lte: addDaysStr(today, days) } },
      select: { date: true, openTime: true, closeTime: true, reason: true },
      orderBy: { date: 'asc' },
    });
  }
}
