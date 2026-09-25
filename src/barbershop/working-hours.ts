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

/** Os 7 dias (0 = domingo) do JSON da unidade; null se não houver ou for inválido. */
export function parseBusinessHours(json: string | null | undefined): DayHours[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, DayHours>;
    return WEEKDAY_KEYS.map((key) => {
      const d = parsed?.[key];
      return d && typeof d.start === 'string' && typeof d.end === 'string'
        ? { start: d.start, end: d.end }
        : null;
    });
  } catch {
    return null;
  }
}

export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
