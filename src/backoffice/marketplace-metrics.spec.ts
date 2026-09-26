import {
  countByWeek,
  mondayOf,
  professionalKey,
  retentionOf,
  retentionWindows,
  timeToFirst,
  weekRangeUtc,
  weekStarts,
} from './marketplace-metrics';

const day = (iso: string) => new Date(iso);

describe('marketplace-metrics', () => {
  it('a semana começa na segunda, inclusive no domingo', () => {
    expect(mondayOf('2026-09-26')).toBe('2026-09-21');
    expect(mondayOf('2026-09-21')).toBe('2026-09-21');
    expect(mondayOf('2026-09-27')).toBe('2026-09-21');
  });

  it('monta 8 segundas, da mais antiga à semana atual', () => {
    const starts = weekStarts('2026-09-26', 8);
    expect(starts).toHaveLength(8);
    expect(starts[0]).toBe('2026-08-03');
    expect(starts[7]).toBe('2026-09-21');
  });

  it('o intervalo da semana cobre o domingo no fuso da plataforma', () => {
    const range = weekRangeUtc(['2026-09-21'], 'America/Sao_Paulo');
    expect(range.start.toISOString()).toBe('2026-09-21T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-09-28T03:00:00.000Z');
  });

  it('a janela atual tem 28 dias e a anterior encosta nela', () => {
    const windows = retentionWindows('2026-09-26', 28, 'America/Sao_Paulo');
    expect(windows.currentStart.toISOString()).toBe('2026-08-30T03:00:00.000Z');
    expect(windows.priorStart.toISOString()).toBe('2026-08-02T03:00:00.000Z');
    expect(windows.end.toISOString()).toBe('2026-09-27T03:00:00.000Z');
  });

  it('conta o atendimento na semana do dia, e ignora o que cai fora', () => {
    const starts = weekStarts('2026-09-26', 2);
    expect(countByWeek(['2026-09-21', '2026-09-27', '2026-09-14', '2026-08-01'], starts)).toEqual([
      1, 2,
    ]);
  });

  it('junta a mesma pessoa em duas unidades e separa quem não tem usuário', () => {
    expect(professionalKey({ id: 1, userId: 9 })).toBe(professionalKey({ id: 2, userId: 9 }));
    expect(professionalKey({ id: 3, userId: null })).not.toBe(professionalKey({ id: 4, userId: null }));
  });

  it('retenção é quem voltou sobre quem já tinha agendado; sem base, a taxa é zero', () => {
    expect(retentionOf(['a', 'b', 'a', 'c'], ['b', 'd', 'b'])).toEqual({
      prior: 3,
      returning: 1,
      rate: 1 / 3,
    });
    expect(retentionOf([], ['a'])).toEqual({ prior: 0, returning: 0, rate: 0 });
  });

  it('mediana até o primeiro atendimento, e a fração que agendou na primeira semana', () => {
    const now = day('2026-09-26T12:00:00.000Z');
    const result = timeToFirst(
      [
        { createdAt: day('2026-09-01T00:00:00.000Z'), firstAt: day('2026-09-04T00:00:00.000Z') },
        { createdAt: day('2026-09-01T00:00:00.000Z'), firstAt: day('2026-09-11T00:00:00.000Z') },
        { createdAt: day('2026-08-01T00:00:00.000Z'), firstAt: null },
        { createdAt: day('2026-09-24T00:00:00.000Z'), firstAt: null },
      ],
      now,
    );
    expect(result.medianDays).toBe(6.5);
    expect(result.withAppointment).toBe(2);
    expect(result.withoutAppointment).toBe(2);
    expect(result.eligibleFor7Days).toBe(3);
    expect(result.activatedWithin7DaysRate).toBeCloseTo(1 / 3);
  });

  it('sem nenhum atendimento a mediana fica vazia', () => {
    const result = timeToFirst(
      [{ createdAt: day('2026-01-01T00:00:00.000Z'), firstAt: null }],
      day('2026-09-26T00:00:00.000Z'),
    );
    expect(result.medianDays).toBeNull();
    expect(result.activatedWithin7DaysRate).toBe(0);
  });
});
