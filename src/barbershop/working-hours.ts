import { BadRequestException } from '@nestjs/common';

/**
 * Horário de funcionamento: o da unidade (Barbershop.businessHours, JSON
 * { monday: { start, end } | null, ... }) ou, sem ele, o padrão embutido.
 * A escala de cada profissional (BarberSchedule) vale por cima deste.
 */
export type DayHours = { start: string; end: string } | null;

export const DEFAULT_WORKING_HOURS: Record<number, DayHours> = {
  0: null, // domingo fechado por padrão
  1: { start: '09:00', end: '18:00' },
  2: { start: '09:00', end: '18:00' },
  3: { start: '09:00', end: '18:00' },
  4: { start: '09:00', end: '18:00' },
  5: { start: '09:00', end: '18:00' },
  6: { start: '09:00', end: '17:00' },
};

export const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const validRange = (start: unknown, end: unknown): { start: string; end: string } | null => {
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  if (!TIME.test(start) || !TIME.test(end) || start >= end) return null;
  return { start, end };
};

/**
 * Os 7 dias (0 = domingo) do JSON da unidade. Sem JSON ou com JSON quebrado,
 * null (vale o padrão). Dia ausente, fechado, fora de HH:MM ou com início
 * depois do fim fica fechado; os outros dias valem.
 */
export function minutesOfTime(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A escala própria cabe no expediente. Dia em que a unidade não abre não cabe. */
export function fitsShopHours(
  start: string,
  end: string,
  shop: { start: string; end: string } | null,
): boolean {
  if (!shop) return false;
  const a = minutesOfTime(start);
  const b = minutesOfTime(end);
  return a < b && a >= minutesOfTime(shop.start) && b <= minutesOfTime(shop.end);
}

/** Corta a janela do profissional no expediente da unidade. Fora dele, não há horário. */
export function clipToShopHours<T extends { start: string; end: string }>(
  window: T,
  shop: { start: string; end: string } | null,
): T | null {
  if (!shop) return null;
  const start = Math.max(minutesOfTime(window.start), minutesOfTime(shop.start));
  const end = Math.min(minutesOfTime(window.end), minutesOfTime(shop.end));
  if (start >= end) return null;
  return { ...window, start: hhmm(start), end: hhmm(end) };
}

export function parseBusinessHours(json: string | null | undefined): DayHours[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, { start?: unknown; end?: unknown } | null>;
    return WEEKDAY_KEYS.map((key) => {
      const day = parsed?.[key];
      if (!day) return null;
      return validRange(day.start, day.end);
    });
  } catch {
    return null;
  }
}

const HOURS_INVALID = 'horário inválido (use HH:MM, início antes do fim)';

/**
 * O mesmo que a tela de horário exige: os 7 dias, cada um fechado ou com
 * HH:MM e início antes do fim. Devolve o JSON que fica gravado.
 */
export function normalizeBusinessHours(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BadRequestException('Informe os 7 dias da semana');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestException('Informe os 7 dias da semana');
  }
  const src = parsed as Record<string, unknown>;
  const out: Record<string, DayHours> = {};
  for (const key of WEEKDAY_KEYS) {
    if (!(key in src)) throw new BadRequestException('Informe os 7 dias da semana');
    const day = src[key];
    if (day == null) {
      out[key] = null;
      continue;
    }
    if (typeof day !== 'object' || Array.isArray(day)) {
      throw new BadRequestException(`${key}: ${HOURS_INVALID}`);
    }
    const range = validRange((day as { start?: unknown }).start, (day as { end?: unknown }).end);
    if (!range) throw new BadRequestException(`${key}: ${HOURS_INVALID}`);
    out[key] = range;
  }
  return JSON.stringify(out);
}
