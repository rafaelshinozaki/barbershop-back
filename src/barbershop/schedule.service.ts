import { must } from '../common/must';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService, currentEngagement } from './barbershop.service';
import { appointmentContactEmail } from './appointment-contact';
import { safeTimeZone, toZonedParts } from '../common/timezone.util';
import {
  DEFAULT_WORKING_HOURS,
  parseBusinessHours,
  TIME,
  WEEKDAY_KEYS,
  type DayHours,
} from './working-hours';

export type BusinessDayInput = {
  dayOfWeek: number;
  open: boolean;
  start?: string | null;
  end?: string | null;
};

/** SHOP: segue o horário da unidade; CUSTOM: horário próprio; OFF: folga fixa */
export type ScheduleMode = 'SHOP' | 'CUSTOM' | 'OFF';

export type ScheduleDayInput = {
  dayOfWeek: number;
  mode: ScheduleMode;
  startTime?: string | null;
  endTime?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
};

const MODES: ScheduleMode[] = ['SHOP', 'CUSTOM', 'OFF'];

/** Expediente de um dia (HH:MM), com o intervalo quando há; null = não trabalha */
type DayWindow = {
  start: string;
  end: string;
  breakStart?: string | null;
  breakEnd?: string | null;
} | null;

/** Horário já marcado que fica fora do expediente novo */
export type ScheduleImpact = {
  id: number;
  startAt: Date;
  customerName: string;
  barberName: string;
  hasEmail: boolean;
};

const IMPACT_LIMIT = 500;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** O horário (em minutos do dia) cabe no expediente e não pega o intervalo? */
export function fitsWindow(window: DayWindow, start: number, end: number): boolean {
  if (!window) return false;
  if (start < toMinutes(window.start) || end > toMinutes(window.end)) return false;
  if (window.breakStart && window.breakEnd) {
    const bs = toMinutes(window.breakStart);
    const be = toMinutes(window.breakEnd);
    if (start < be && end > bs) return false;
  }
  return true;
}

function checkDays<T extends { dayOfWeek: number }>(days: T[]) {
  const seen = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6) {
      throw new BadRequestException('Dia da semana inválido');
    }
    if (seen.has(d.dayOfWeek)) throw new BadRequestException('Dia da semana repetido');
    seen.add(d.dayOfWeek);
  }
}

function checkRange(
  start: string | null | undefined,
  end: string | null | undefined,
  label: string,
): { start: string; end: string } {
  if (!start || !end || !TIME.test(start) || !TIME.test(end) || start >= end) {
    throw new BadRequestException(`${label}: horário inválido (use HH:MM, início antes do fim)`);
  }
  return { start, end };
}

/**
 * Horário de funcionamento da unidade e escala semanal de cada
 * profissional. É o que a página pública usa pra oferecer horários (junto
 * com folgas e fechamentos): sem escala própria num dia, o profissional
 * segue o horário da unidade; sem horário da unidade, vale o padrão.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly barbershopService: BarbershopService,
  ) {}

  private async shopHours(barbershopId: number) {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { businessHours: true },
    });
    const custom = parseBusinessHours(shop?.businessHours);
    return {
      isDefault: !custom,
      days: custom ?? [0, 1, 2, 3, 4, 5, 6].map((d) => DEFAULT_WORKING_HOURS[d]),
    };
  }

  async getBusinessHours(userId: number, barbershopId: number) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'basic');
    const { isDefault, days } = await this.shopHours(barbershopId);
    return days.map((d, dayOfWeek) => ({
      dayOfWeek,
      open: d != null,
      start: d?.start ?? null,
      end: d?.end ?? null,
      isDefault,
    }));
  }

  private parseBusinessDays(days: BusinessDayInput[]) {
    checkDays(days);
    if (days.length !== 7) throw new BadRequestException('Informe os 7 dias da semana');
    const json: Record<string, DayHours> = {};
    for (const d of days) {
      json[WEEKDAY_KEYS[d.dayOfWeek]] = d.open
        ? checkRange(d.start, d.end, WEEKDAY_KEYS[d.dayOfWeek])
        : null;
    }
    return json;
  }

  /**
   * Antes de salvar o horário da unidade: os horários já marcados de quem
   * segue esse horário que ficam fora dele (item 241).
   */
  async businessHoursImpact(userId: number, barbershopId: number, days: BusinessDayInput[]) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const json = this.parseBusinessDays(days);
    const rows = await this.prisma.barberSchedule.findMany({
      where: { barber: { barbershopId } },
    });
    return this.outside(barbershopId, null, (barberId, dayOfWeek) => {
      const row = rows.find((r) => r.barberId === barberId && r.dayOfWeek === dayOfWeek);
      if (row) return row.isActive ? this.rowWindow(row) : null;
      return json[WEEKDAY_KEYS[dayOfWeek]] ?? null;
    });
  }

  /** Os 7 dias; dia fechado = open false. Gerente e dono. */
  async setBusinessHours(userId: number, barbershopId: number, days: BusinessDayInput[]) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    const json = this.parseBusinessDays(days);
    // Quem segue o horário da unidade e trabalha em outra: o expediente novo
    // não pode cruzar o de lá (a escala do profissional já confere isso)
    const team = await this.prisma.barber.findMany({
      where: { barbershopId, isActive: true, ...currentEngagement() },
      select: { id: true, schedules: { select: { dayOfWeek: true } } },
    });
    for (const barber of team) {
      const own = new Set(barber.schedules.map((r) => r.dayOfWeek));
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const hours = json[WEEKDAY_KEYS[dayOfWeek]];
        if (!hours || own.has(dayOfWeek)) continue;
        await this.barbershopService.ensureShiftFreeAcrossShops(
          barber.id,
          dayOfWeek,
          hours.start,
          hours.end,
        );
      }
    }
    // Horário ampliado pode abrir vaga para quem está na lista de espera
    await this.barbershopService.withWaitlistOpening(barbershopId, {}, () =>
      this.prisma.barbershop.update({
        where: { id: barbershopId },
        data: { businessHours: JSON.stringify(json) },
      }),
    );
    return this.getBusinessHours(userId, barbershopId);
  }

  private async barberOrThrow(barberId: number) {
    const barber = await this.prisma.barber.findUnique({
      where: { id: barberId },
      select: { id: true, barbershopId: true },
    });
    if (!barber) throw new NotFoundException('Profissional não encontrado');
    return barber;
  }

  /** Semana do profissional: o que vale em cada dia e de onde vem. */
  async getWeeklySchedule(userId: number, barberId: number) {
    const barber = await this.barberOrThrow(barberId);
    await this.barbershopService.ensureAccess(userId, barber.barbershopId, 'basic');
    const [rows, shop] = await Promise.all([
      this.prisma.barberSchedule.findMany({ where: { barberId } }),
      this.shopHours(barber.barbershopId),
    ]);
    return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => {
      const row = rows.find((r) => r.dayOfWeek === dayOfWeek);
      const shopDay = shop.days[dayOfWeek];
      if (!row) {
        return {
          dayOfWeek,
          mode: 'SHOP' as ScheduleMode,
          startTime: shopDay?.start ?? null,
          endTime: shopDay?.end ?? null,
          breakStart: null,
          breakEnd: null,
          working: shopDay != null,
        };
      }
      return {
        dayOfWeek,
        mode: (row.isActive ? 'CUSTOM' : 'OFF') as ScheduleMode,
        startTime: row.isActive ? row.startTime : null,
        endTime: row.isActive ? row.endTime : null,
        breakStart: row.isActive ? row.breakStart : null,
        breakEnd: row.isActive ? row.breakEnd : null,
        working: row.isActive,
      };
    });
  }

  private checkWeeklyDays(days: ScheduleDayInput[]) {
    checkDays(days);
    for (const d of days) {
      if (!MODES.includes(d.mode)) throw new BadRequestException('Tipo de dia inválido');
      if (d.mode !== 'CUSTOM') continue;
      const label = WEEKDAY_KEYS[d.dayOfWeek];
      const work = checkRange(d.startTime, d.endTime, label);
      if (!!d.breakStart !== !!d.breakEnd) {
        throw new BadRequestException(`${label}: informe o início e o fim do intervalo`);
      }
      if (d.breakStart) {
        const pause = checkRange(d.breakStart, d.breakEnd, `${label} (intervalo)`);
        if (pause.start <= work.start || pause.end >= work.end) {
          throw new BadRequestException(`${label}: o intervalo precisa ficar dentro do expediente`);
        }
      }
    }
  }

  private rowWindow(row: {
    startTime: string;
    endTime: string;
    breakStart: string | null;
    breakEnd: string | null;
  }): DayWindow {
    return {
      start: row.startTime,
      end: row.endTime,
      breakStart: row.breakStart,
      breakEnd: row.breakEnd,
    };
  }

  /**
   * Antes de salvar a escala do profissional: os horários já marcados dele
   * que ficam fora do expediente novo (item 241).
   */
  async weeklyScheduleImpact(userId: number, barberId: number, days: ScheduleDayInput[]) {
    const barber = await this.barberOrThrow(barberId);
    await this.barbershopService.ensureCanManageBarberSchedule(
      userId,
      barber.barbershopId,
      barberId,
    );
    this.checkWeeklyDays(days);
    const [rows, shop] = await Promise.all([
      this.prisma.barberSchedule.findMany({ where: { barberId } }),
      this.shopHours(barber.barbershopId),
    ]);
    return this.outside(barber.barbershopId, barberId, (_id, dayOfWeek) => {
      const d = days.find((x) => x.dayOfWeek === dayOfWeek);
      if (d) {
        if (d.mode === 'OFF') return null;
        if (d.mode === 'CUSTOM') {
          return {
            start: must(d.startTime, 'início'),
            end: must(d.endTime, 'fim'),
            breakStart: d.breakStart || null,
            breakEnd: d.breakEnd || null,
          };
        }
        return shop.days[dayOfWeek] ?? null;
      }
      const row = rows.find((r) => r.dayOfWeek === dayOfWeek);
      if (row) return row.isActive ? this.rowWindow(row) : null;
      return shop.days[dayOfWeek] ?? null;
    });
  }

  /**
   * Horários marcados daqui pra frente (confirmados ou esperando o sinal)
   * que não cabem no expediente do dia. Dia com fechamento cadastrado fica de
   * fora: lá vale o fechamento, que já mostra quem é afetado.
   */
  private async outside(
    barbershopId: number,
    barberId: number | null,
    windowFor: (barberId: number, dayOfWeek: number) => DayWindow,
  ): Promise<ScheduleImpact[]> {
    const shop = await this.prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { timezone: true },
    });
    const timeZone = safeTimeZone(shop?.timezone);
    const now = new Date();
    const closures = await this.prisma.barbershopClosure.findMany({
      where: { barbershopId, date: { gte: toZonedParts(now, timeZone).dateStr } },
      select: { date: true },
    });
    const closed = new Set(closures.map((c) => c.date));
    const appts: {
      id: number;
      startAt: Date;
      endAt: Date;
      barberId: number;
      contactEmail: string | null;
      customer: { name: string; email: string | null };
      barber: { name: string };
    }[] = [];
    let cursor: { startAt: Date; id: number } | null = null;
    for (;;) {
      const page = await this.prisma.appointment.findMany({
        where: {
          barbershopId,
          ...(barberId != null ? { barberId } : {}),
          status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
          startAt: { gte: now },
          ...(cursor
            ? {
                OR: [
                  { startAt: { gt: cursor.startAt } },
                  { startAt: cursor.startAt, id: { gt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        take: IMPACT_LIMIT,
        select: {
          id: true,
          startAt: true,
          endAt: true,
          barberId: true,
          contactEmail: true,
          customer: { select: { name: true, email: true } },
          barber: { select: { name: true } },
        },
      });
      appts.push(...page);
      if (page.length < IMPACT_LIMIT) break;
      const last = page[page.length - 1];
      cursor = { startAt: last.startAt, id: last.id };
    }
    return appts
      .filter((a) => {
        const start = toZonedParts(a.startAt, timeZone);
        if (closed.has(start.dateStr)) return false;
        const end = toZonedParts(a.endAt, timeZone);
        // Atravessa a meia-noite: fim conta como 24:00 daquele dia
        const endMinutes = end.dateStr === start.dateStr ? end.minutesOfDay : 24 * 60;
        return !fitsWindow(windowFor(a.barberId, start.dayOfWeek), start.minutesOfDay, endMinutes);
      })
      .map((a) => ({
        id: a.id,
        startAt: a.startAt,
        customerName: a.customer.name,
        barberName: a.barber.name,
        hasEmail: Boolean(appointmentContactEmail(a)),
      }));
  }

  /**
   * Troca a semana do profissional de uma vez (só os dias enviados). Gerente
   * e dono mexem em qualquer um; o profissional, na própria.
   */
  async setWeeklySchedule(userId: number, barberId: number, days: ScheduleDayInput[]) {
    const barber = await this.barberOrThrow(barberId);
    await this.barbershopService.ensureCanManageBarberSchedule(
      userId,
      barber.barbershopId,
      barberId,
    );
    this.checkWeeklyDays(days);
    // A mesma pessoa em outra unidade: o expediente efetivo do dia (o próprio
    // ou o da unidade) não pode cruzar o de lá
    for (const d of days) {
      if (d.mode === 'OFF') continue;
      const window =
        d.mode === 'CUSTOM'
          ? { start: d.startTime as string, end: d.endTime as string }
          : await this.barbershopService.shopHoursOn(barber.barbershopId, d.dayOfWeek);
      if (!window) continue;
      await this.barbershopService.ensureShiftFreeAcrossShops(
        barberId,
        d.dayOfWeek,
        window.start,
        window.end,
      );
    }
    // Escala ampliada pode abrir vaga para quem está na lista de espera
    await this.barbershopService.withWaitlistOpening(barber.barbershopId, { barberId }, () =>
      this.prisma.$transaction(
        days.map((d) => {
          const where = { barberId_dayOfWeek: { barberId, dayOfWeek: d.dayOfWeek } };
          if (d.mode === 'SHOP') {
            return this.prisma.barberSchedule.deleteMany({
              where: { barberId, dayOfWeek: d.dayOfWeek },
            });
          }
          const data =
            d.mode === 'OFF'
              ? // Folga fixa: linha inativa (os horários não importam)
                {
                  startTime: '00:00',
                  endTime: '00:00',
                  breakStart: null,
                  breakEnd: null,
                  isActive: false,
                }
              : {
                  startTime: must(d.startTime, 'início do expediente'),
                  endTime: must(d.endTime, 'fim do expediente'),
                  breakStart: d.breakStart || null,
                  breakEnd: d.breakEnd || null,
                  isActive: true,
                };
          return this.prisma.barberSchedule.upsert({
            where,
            create: { barberId, dayOfWeek: d.dayOfWeek, ...data },
            update: data,
          });
        }),
      ),
    );
    return this.getWeeklySchedule(userId, barberId);
  }
}
