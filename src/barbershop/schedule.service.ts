import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BarbershopService } from './barbershop.service';
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
) {
  if (!start || !end || !TIME.test(start) || !TIME.test(end) || start >= end) {
    throw new BadRequestException(`${label}: horário inválido (use HH:MM, início antes do fim)`);
  }
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

  /** Os 7 dias; dia fechado = open false. Gerente e dono. */
  async setBusinessHours(userId: number, barbershopId: number, days: BusinessDayInput[]) {
    await this.barbershopService.ensureAccess(userId, barbershopId, 'manager');
    checkDays(days);
    if (days.length !== 7) throw new BadRequestException('Informe os 7 dias da semana');
    const json: Record<string, DayHours> = {};
    for (const d of days) {
      if (d.open) checkRange(d.start, d.end, WEEKDAY_KEYS[d.dayOfWeek]);
      json[WEEKDAY_KEYS[d.dayOfWeek]] = d.open ? { start: d.start!, end: d.end! } : null;
    }
    await this.prisma.barbershop.update({
      where: { id: barbershopId },
      data: { businessHours: JSON.stringify(json) },
    });
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
    checkDays(days);
    for (const d of days) {
      if (!MODES.includes(d.mode)) throw new BadRequestException('Tipo de dia inválido');
      if (d.mode !== 'CUSTOM') continue;
      const label = WEEKDAY_KEYS[d.dayOfWeek];
      checkRange(d.startTime, d.endTime, label);
      if (!!d.breakStart !== !!d.breakEnd) {
        throw new BadRequestException(`${label}: informe o início e o fim do intervalo`);
      }
      if (d.breakStart) {
        checkRange(d.breakStart, d.breakEnd, `${label} (intervalo)`);
        if (d.breakStart <= d.startTime! || d.breakEnd! >= d.endTime!) {
          throw new BadRequestException(`${label}: o intervalo precisa ficar dentro do expediente`);
        }
      }
    }
    await this.prisma.$transaction(
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
                startTime: d.startTime!,
                endTime: d.endTime!,
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
    );
    return this.getWeeklySchedule(userId, barberId);
  }
}
