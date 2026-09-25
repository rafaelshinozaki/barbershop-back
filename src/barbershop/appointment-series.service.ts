import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { addDaysStr, safeTimeZone, toZonedParts, zonedTimeToUtc } from '../common/timezone.util';
import { langForCountry, LOCALE } from '../email/language';
import { BarbershopService } from './barbershop.service';

const MAX_OCCURRENCES = 26;
const MAX_INTERVAL_WEEKS = 8;

export type SeriesInput = {
  customerId: number;
  barberId: number;
  resourceId?: number;
  /** Primeiro horário; os próximos, no mesmo dia da semana e hora local */
  startAt: Date;
  endAt: Date;
  notes?: string;
  services: Array<{ serviceId: number; quantity?: number; unitPrice: number }>;
  intervalWeeks: number;
  occurrences: number;
};

export type SeriesSlot = {
  index: number;
  startAt: Date;
  endAt: Date;
  /** Dá pra marcar (sem conflito com outro horário, folga ou fechamento) */
  ok: boolean;
  /** Motivo de não dar (ocupado, folga, unidade fechada) */
  reason?: string | null;
  /** Dá, mas fora do expediente do profissional (a equipe decide) */
  warning?: string | null;
};

/**
 * Agendamento recorrente, como no Booksy: cliente fixo "a cada 1, 2, 3 ou
 * 4 semanas". A equipe vê antes quais datas dão (e por que as outras não),
 * cria todas de uma vez pulando as que batem, e depois cancela só um
 * horário (como qualquer outro) ou este e os próximos da série.
 */
@Injectable()
export class AppointmentSeriesService {
  private readonly logger = new Logger(AppointmentSeriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
  ) {}

  private async shop(barbershopId: number) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true, country: true },
    });
    if (!shop) throw new NotFoundException('Unidade não encontrada');
    return { timeZone: safeTimeZone(shop.timezone), country: shop.country };
  }

  /** As datas da série: mesmo dia da semana e hora local, a cada N semanas. */
  private dates(input: SeriesInput, timeZone: string) {
    if (
      !Number.isInteger(input.intervalWeeks) ||
      input.intervalWeeks < 1 ||
      input.intervalWeeks > MAX_INTERVAL_WEEKS
    ) {
      throw new BadRequestException(`Repetir a cada 1 a ${MAX_INTERVAL_WEEKS} semanas`);
    }
    if (
      !Number.isInteger(input.occurrences) ||
      input.occurrences < 2 ||
      input.occurrences > MAX_OCCURRENCES
    ) {
      throw new BadRequestException(`De 2 a ${MAX_OCCURRENCES} horários por série`);
    }
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    const duration = end.getTime() - start.getTime();
    if (isNaN(duration) || duration <= 0) throw new BadRequestException('Horário inválido');
    const local = toZonedParts(start, timeZone);
    return Array.from({ length: input.occurrences }, (_, index) => {
      // Pelo relógio da unidade (troca de horário de verão não desloca a hora)
      const date = addDaysStr(local.dateStr, index * input.intervalWeeks * 7);
      const startAt = zonedTimeToUtc(date, local.minutesOfDay, timeZone);
      return { index, date, startAt, endAt: new Date(startAt.getTime() + duration) };
    });
  }

  private async check(
    barbershopId: number,
    barberId: number,
    slot: { date: string; startAt: Date; endAt: Date },
    timeZone: string,
  ): Promise<{ ok: boolean; reason: string | null; warning: string | null }> {
    try {
      await this.barbershopService.ensureBarberAvailable(
        barbershopId,
        barberId,
        slot.startAt,
        slot.endAt,
      );
    } catch (err) {
      if (err instanceof BadRequestException)
        return { ok: false, reason: err.message, warning: null };
      throw err;
    }
    const [timeOff, closure] = await Promise.all([
      this.prisma.barberTimeOff.findFirst({
        where: { barberId, startAt: { lt: slot.endAt }, endAt: { gt: slot.startAt } },
        select: { id: true },
      }),
      this.prisma.barbershopClosure.findUnique({
        where: { barbershopId_date: { barbershopId, date: slot.date } },
      }),
    ]);
    if (timeOff) return { ok: false, reason: 'Profissional de folga nesse dia', warning: null };
    if (closure && !closure.openTime) {
      return {
        ok: false,
        reason: closure.reason ? `Unidade fechada (${closure.reason})` : 'Unidade fechada',
        warning: null,
      };
    }
    // Fora do expediente não impede (a equipe pode marcar exceção), só avisa
    const window = await this.barbershopService.getWorkingWindowOn(
      barbershopId,
      barberId,
      slot.date,
    );
    const start = toZonedParts(slot.startAt, timeZone).minutesOfDay;
    const end = start + Math.round((slot.endAt.getTime() - slot.startAt.getTime()) / 60000);
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const outside = !window || start < toMin(window.start) || end > toMin(window.end);
    return {
      ok: true,
      reason: null,
      warning: outside ? 'Fora do expediente do profissional' : null,
    };
  }

  /** Antes de criar: cada data, se dá e por quê. */
  async preview(userId: number, barbershopId: number, input: SeriesInput): Promise<SeriesSlot[]> {
    await this.barbershopService.ensureCanBookForBarber(userId, barbershopId, input.barberId);
    const { timeZone } = await this.shop(barbershopId);
    const slots = this.dates(input, timeZone);
    return Promise.all(
      slots.map(async (s) => ({
        index: s.index,
        startAt: s.startAt,
        endAt: s.endAt,
        ...(await this.check(barbershopId, input.barberId, s, timeZone)),
      })),
    );
  }

  /**
   * Cria a série pulando as datas que não dão. Cada horário passa pela
   * mesma checagem (e trava) do agendamento avulso; o cliente recebe uma
   * confirmação só, com todas as datas.
   */
  async create(userId: number, barbershopId: number, input: SeriesInput) {
    await this.barbershopService.ensureCanBookForBarber(userId, barbershopId, input.barberId);
    const { timeZone, country } = await this.shop(barbershopId);
    const slots = this.dates(input, timeZone);
    const seriesId = randomUUID();
    const created: Array<{ id: number; startAt: Date; customer: { email: string | null } }> = [];
    const skipped: SeriesSlot[] = [];
    for (const s of slots) {
      const check = await this.check(barbershopId, input.barberId, s, timeZone);
      if (!check.ok) {
        skipped.push({ index: s.index, startAt: s.startAt, endAt: s.endAt, ...check });
        continue;
      }
      try {
        const appt = await this.barbershopService.createAppointment(
          userId,
          barbershopId,
          {
            customerId: input.customerId,
            barberId: input.barberId,
            resourceId: input.resourceId,
            startAt: s.startAt,
            endAt: s.endAt,
            notes: input.notes,
            services: input.services,
            seriesId,
            seriesIndex: s.index,
          },
          { notify: false },
        );
        if (appt) created.push(appt as never);
      } catch (err) {
        // Alguém marcou nesse meio tempo: pula essa data
        if (!(err instanceof BadRequestException)) throw err;
        skipped.push({
          index: s.index,
          startAt: s.startAt,
          endAt: s.endAt,
          ok: false,
          reason: err.message,
        });
      }
    }
    if (created.length === 0) {
      throw new BadRequestException('Nenhuma data da série está livre');
    }
    const email = await this.customerEmail(input.customerId);
    if (email) {
      this.barbershopService
        .notifySeriesConfirmed(
          created[0].id,
          email,
          this.formatDates(
            created.map((c) => c.startAt),
            timeZone,
            country,
          ),
        )
        .catch((err) => this.logger.error(`Erro ao confirmar a série ${seriesId}:`, err));
    }
    return {
      seriesId,
      createdCount: created.length,
      skipped,
      appointmentIds: created.map((c) => c.id),
    };
  }

  /**
   * Cancela este horário e os próximos da série (os que ainda estão
   * confirmados). O cliente recebe um aviso só, com as datas canceladas.
   */
  async cancelFromHere(userId: number, barbershopId: number, appointmentId: number) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, barbershopId },
      select: { id: true, seriesId: true, barberId: true, startAt: true, customerId: true },
    });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    if (!appt.seriesId) throw new BadRequestException('Este horário não faz parte de uma série');
    await this.barbershopService.ensureCanBookForBarber(userId, barbershopId, appt.barberId);
    const targets = await this.prisma.appointment.findMany({
      where: {
        seriesId: appt.seriesId,
        barbershopId,
        status: 'CONFIRMED',
        startAt: { gte: appt.startAt },
      },
      select: { id: true, startAt: true },
      orderBy: { startAt: 'asc' },
    });
    if (targets.length === 0) return { cancelledCount: 0 };
    await this.prisma.appointment.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, status: 'CONFIRMED' },
      data: { status: 'CANCELLED' },
    });
    const email = await this.customerEmail(appt.customerId);
    if (email && targets[0].startAt > new Date()) {
      const { timeZone, country } = await this.shop(barbershopId);
      this.barbershopService
        .notifyAppointmentCancelled(
          targets[0].id,
          email,
          null,
          this.formatDates(
            targets.map((t) => t.startAt),
            timeZone,
            country,
          ),
        )
        .catch((err) => this.logger.error(`Erro ao avisar cancelamento da série:`, err));
    }
    return { cancelledCount: targets.length };
  }

  private async customerEmail(customerId: number) {
    const c = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { email: true },
    });
    return c?.email ?? null;
  }

  private formatDates(dates: Date[], timeZone: string, country: string | null) {
    const locale = LOCALE[langForCountry(country)];
    return dates.map((d) =>
      d.toLocaleString(locale, {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }),
    );
  }
}
