import { reminderCoveredByNotice, reminderSentAtAfterMove } from './reminder-window';

describe('reminder window', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('horário dentro de 24 h já foi avisado pela remarcação', () => {
    const start = new Date('2026-10-16T08:00:00Z');
    expect(reminderCoveredByNotice(now, start)).toBe(true);
    expect(reminderSentAtAfterMove(start, now)).toEqual(now);
  });

  it('horário mais longe ainda recebe o lembrete', () => {
    const start = new Date('2026-10-20T12:00:00Z');
    expect(reminderCoveredByNotice(now, start)).toBe(false);
    expect(reminderSentAtAfterMove(start, now)).toBeNull();
  });
});
