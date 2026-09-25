import {
  reportPeriod,
  DEFAULT_TIMEZONE,
  addDaysStr,
  monthRangeUtc,
  dayOfWeekOf,
  nextDateStr,
  safeTimeZone,
  toZonedParts,
  zonedTimeToUtc,
} from './timezone.util';

// Os resultados não podem depender do fuso do processo — rode também com
// TZ=Asia/Tokyo / TZ=America/Sao_Paulo pra conferir.
describe('timezone.util', () => {
  it('converte hora de parede de São Paulo pra UTC', () => {
    expect(zonedTimeToUtc('2026-09-25', 9 * 60, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-25T12:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-09-25', 18 * 60 + 30, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-25T21:30:00.000Z',
    );
  });

  it('meia-noite local vira o início do dia na unidade', () => {
    expect(zonedTimeToUtc('2026-09-25', 0, 'America/Sao_Paulo').toISOString()).toBe(
      '2026-09-25T03:00:00.000Z',
    );
  });

  it('respeita horário de verão (Nova York antes e depois da troca)', () => {
    // 2026-03-08: EST (-5) vira EDT (-4) às 02:00
    expect(zonedTimeToUtc('2026-03-07', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-09', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('toZonedParts devolve data, dia da semana e minutos no fuso da unidade', () => {
    // 00:30 UTC de sábado = 21:30 de sexta em Brasília
    expect(toZonedParts(new Date('2026-09-26T00:30:00Z'), 'America/Sao_Paulo')).toEqual({
      dateStr: '2026-09-25',
      dayOfWeek: 5,
      minutesOfDay: 21 * 60 + 30,
    });
  });

  it('ida e volta preserva a hora de parede', () => {
    for (const minutes of [0, 9 * 60, 12 * 60 + 15, 23 * 60 + 45]) {
      const instant = zonedTimeToUtc('2026-11-02', minutes, 'America/Sao_Paulo');
      expect(toZonedParts(instant, 'America/Sao_Paulo')).toMatchObject({
        dateStr: '2026-11-02',
        minutesOfDay: minutes,
      });
    }
  });

  it('dayOfWeekOf e nextDateStr trabalham só com a data de calendário', () => {
    expect(dayOfWeekOf('2026-09-27')).toBe(0);
    expect(dayOfWeekOf('2026-09-25')).toBe(5);
    expect(nextDateStr('2026-12-31')).toBe('2027-01-01');
    expect(nextDateStr('2028-02-28')).toBe('2028-02-29');
  });

  it('fuso inválido ou vazio cai no padrão', () => {
    expect(safeTimeZone('Nao/Existe')).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone(null)).toBe(DEFAULT_TIMEZONE);
    expect(safeTimeZone('Europe/Lisbon')).toBe('Europe/Lisbon');
  });

  it('addDaysStr e monthRangeUtc', () => {
    expect(addDaysStr('2026-03-01', -1)).toBe('2026-02-28');
    const sep = monthRangeUtc(2026, 9, 'America/Sao_Paulo');
    expect(sep.start.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(sep.end.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    const dec = monthRangeUtc(2026, 0, 'America/Sao_Paulo');
    expect(dec.start.toISOString()).toBe('2025-12-01T03:00:00.000Z');
  });

  it('reportPeriod: dias no calendário da unidade, último dia inteiro', () => {
    const p = reportPeriod('America/Sao_Paulo', '2026-09-01', '2026-09-30');
    expect(p.gte!.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(p.lte!.toISOString()).toBe('2026-10-01T02:59:59.999Z');
    expect(reportPeriod('America/Sao_Paulo')).toEqual({ gte: undefined, lte: undefined });
    // Com hora, é o instante mesmo
    expect(reportPeriod('Asia/Tokyo', '2026-09-01T10:00:00Z').gte!.toISOString()).toBe(
      '2026-09-01T10:00:00.000Z',
    );
    expect(() => reportPeriod('UTC', 'ontem')).toThrow('Período inválido');
  });
});
