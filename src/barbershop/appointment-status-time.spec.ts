import {
  COMPLETED_TOO_EARLY_MESSAGE,
  NO_SHOW_TOO_EARLY_MESSAGE,
  assertStatusFitsTime,
} from './appointment-status-time';

describe('"Faltou" e "concluído" só depois do início (item 260)', () => {
  const start = new Date('2026-10-23T15:00:00Z');
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it('falta: recusa antes do início e dentro da tolerância; aceita depois', () => {
    expect(() => assertStatusFitsTime('NO_SHOW', start, at(-24 * 60))).toThrow(
      NO_SHOW_TOO_EARLY_MESSAGE,
    );
    expect(() => assertStatusFitsTime('NO_SHOW', start, at(4))).toThrow(NO_SHOW_TOO_EARLY_MESSAGE);
    expect(() => assertStatusFitsTime('NO_SHOW', start, at(5))).not.toThrow();
  });

  it('concluído: recusa antes do início; aceita a partir dele', () => {
    expect(() => assertStatusFitsTime('COMPLETED', start, at(-1))).toThrow(
      COMPLETED_TOO_EARLY_MESSAGE,
    );
    expect(() => assertStatusFitsTime('COMPLETED', start, at(0))).not.toThrow();
  });

  it('cancelar e confirmar valem a qualquer hora', () => {
    for (const status of ['CANCELLED', 'CONFIRMED', 'DRAFT']) {
      expect(() => assertStatusFitsTime(status, start, at(-24 * 60))).not.toThrow();
    }
  });

  it('começar vale a partir de 30 minutos antes do início (item 335)', () => {
    expect(() => assertStatusFitsTime('IN_PROGRESS', start, at(-24 * 60))).toThrow();
    expect(() => assertStatusFitsTime('IN_PROGRESS', start, at(-30))).not.toThrow();
    expect(() => assertStatusFitsTime('IN_PROGRESS', start, at(10))).not.toThrow();
  });
});
