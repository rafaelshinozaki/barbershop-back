import { addDaysStr, dayOfWeekOf, nextDateStr, zonedTimeToUtc } from '../common/timezone.util';

/** Atendimentos que contam como uso: cancelado e reserva sem pagamento ficam de fora. */
export const COUNTED_APPOINTMENT_STATUSES = [
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
] as const;

export const METRIC_WEEKS = 8;
export const RETENTION_DAYS = 28;
const MS_DAY = 86_400_000;

/** Segunda-feira (YYYY-MM-DD) da semana ISO que contém `dateStr`. */
export function mondayOf(dateStr: string): string {
  const dow = dayOfWeekOf(dateStr);
  const back = dow === 0 ? 6 : dow - 1;
  return addDaysStr(dateStr, -back);
}

/** Segundas das últimas `weeks` semanas, da mais antiga à atual (inclui a semana de `today`). */
export function weekStarts(today: string, weeks: number): string[] {
  const current = mondayOf(today);
  const first = addDaysStr(current, -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, i) => addDaysStr(first, 7 * i));
}

/** Início (inclusivo) da primeira semana e fim (exclusivo) do domingo da última. */
export function weekRangeUtc(starts: string[], timeZone: string) {
  const lastMonday = starts[starts.length - 1];
  return {
    start: zonedTimeToUtc(starts[0], 0, timeZone),
    end: zonedTimeToUtc(nextDateStr(addDaysStr(lastMonday, 6)), 0, timeZone),
  };
}

/**
 * Janelas de retenção: os últimos `days` dias (incluindo hoje) e os `days`
 * imediatamente anteriores. Fim é exclusivo.
 */
export function retentionWindows(today: string, days: number, timeZone: string) {
  const currentStart = zonedTimeToUtc(addDaysStr(today, -(days - 1)), 0, timeZone);
  const priorStart = zonedTimeToUtc(addDaysStr(today, -(days * 2 - 1)), 0, timeZone);
  const end = zonedTimeToUtc(nextDateStr(today), 0, timeZone);
  return { priorStart, currentStart, end };
}

export function countByWeek(dateStrs: string[], starts: string[]): number[] {
  const index = new Map(starts.map((week, i) => [week, i]));
  const counts = starts.map(() => 0);
  for (const dateStr of dateStrs) {
    const i = index.get(mondayOf(dateStr));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

/** Mesma pessoa em várias unidades conta uma vez; sem usuário, cada vínculo conta. */
export function professionalKey(barber: { id: number; userId: number | null }): string {
  return barber.userId != null ? `u:${barber.userId}` : `b:${barber.id}`;
}

export function retentionOf(priorIds: Iterable<string>, currentIds: Iterable<string>) {
  const prior = new Set(priorIds);
  const current = new Set(currentIds);
  let returning = 0;
  for (const id of prior) {
    if (current.has(id)) returning += 1;
  }
  return {
    prior: prior.size,
    returning,
    rate: prior.size > 0 ? returning / prior.size : 0,
  };
}

export function medianDays(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(raw * 10) / 10;
}

/**
 * Mediana de dias até o primeiro atendimento, e a fração de quem já tem pelo
 * menos 7 dias e agendou dentro dessa primeira semana. Quem ainda não chegou
 * aos 7 dias fica de fora dessa fração.
 */
export function timeToFirst(
  rows: { createdAt: Date; firstAt: Date | null }[],
  now: Date,
) {
  const days: number[] = [];
  let withoutAppointment = 0;
  let eligibleFor7Days = 0;
  let activatedWithin7Days = 0;
  for (const row of rows) {
    if (row.firstAt) {
      days.push(Math.max(0, (row.firstAt.getTime() - row.createdAt.getTime()) / MS_DAY));
    } else {
      withoutAppointment += 1;
    }
    const ageDays = (now.getTime() - row.createdAt.getTime()) / MS_DAY;
    if (ageDays >= 7) {
      eligibleFor7Days += 1;
      if (row.firstAt && row.firstAt.getTime() - row.createdAt.getTime() <= 7 * MS_DAY) {
        activatedWithin7Days += 1;
      }
    }
  }
  return {
    medianDays: medianDays(days),
    withAppointment: days.length,
    withoutAppointment,
    activatedWithin7DaysRate:
      eligibleFor7Days > 0 ? activatedWithin7Days / eligibleFor7Days : null,
    eligibleFor7Days,
  };
}
