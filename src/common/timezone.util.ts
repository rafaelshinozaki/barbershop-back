// Conversão entre "hora de parede" no fuso de uma unidade e instantes UTC,
// sem depender do fuso do processo Node. O servidor roda em UTC (imagem
// node:alpine sem TZ), então qualquer new Date('2026-09-25T00:00:00') /
// setHours / getDay no código interpretava o horário da barbearia como UTC —
// a agenda pública oferecia 06:00–15:30 pra uma unidade que abre 09:00–19:00
// em Brasília. Usa só Intl (nativo), sem lib de timezone.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Fuso inválido no cadastro não pode derrubar a agenda: cai no padrão.
export function safeTimeZone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Data/hora de parede de um instante no fuso dado. */
export function toZonedParts(instant: Date, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const { year, month, day, hour, minute } = parts;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    dateStr,
    dayOfWeek: dayOfWeekOf(dateStr),
    minutesOfDay: hour * 60 + minute,
  };
}

// Deslocamento (ms) do fuso em relação ao UTC naquele instante — varia com
// horário de verão, por isso é calculado por instante e não fixo.
function offsetMs(instant: Date, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instante UTC de "dateStr às minutesOfDay" no fuso dado.
 * zonedTimeToUtc('2026-09-25', 9 * 60, 'America/Sao_Paulo') → 2026-09-25T12:00:00Z
 */
export function zonedTimeToUtc(dateStr: string, minutesOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  // Primeira estimativa com o offset do próprio "wall clock"; a segunda
  // passada corrige quando o offset muda entre as duas (troca de horário
  // de verão no meio do caminho).
  let guess = wallAsUtc - offsetMs(new Date(wallAsUtc), timeZone);
  guess = wallAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Dia da semana (0 = domingo) de uma data de calendário "YYYY-MM-DD". */
export function dayOfWeekOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "YYYY-MM-DD" do dia seguinte. */
export function nextDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" deslocado de `days` dias (negativo volta). */
export function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Início e fim (exclusivo) de um mês de calendário no fuso dado.
 * `month` é 1-12 e pode sair do intervalo (0 = dezembro do ano anterior).
 */
export function monthRangeUtc(year: number, month: number, timeZone: string) {
  const first = (y: number, m: number) =>
    new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  return {
    start: zonedTimeToUtc(first(year, month), 0, timeZone),
    end: zonedTimeToUtc(first(year, month + 1), 0, timeZone),
  };
}
