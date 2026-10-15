const DAY_MS = 24 * 60 * 60 * 1000;

/** O aviso (confirmação ou remarcação) já cobre o horário se ele começa em até 24 h. */
export function reminderCoveredByNotice(noticeAt: Date, startAt: Date) {
  return startAt.getTime() - noticeAt.getTime() <= DAY_MS;
}

/**
 * Remarcado para dentro de 24 h: o e-mail de remarcação já traz o horário,
 * então o lembrete de 24 h não sai de novo. Mais longe, o lembrete volta a valer.
 */
export function reminderSentAtAfterMove(startAt: Date, now = new Date()): Date | null {
  return reminderCoveredByNotice(now, startAt) ? now : null;
}
