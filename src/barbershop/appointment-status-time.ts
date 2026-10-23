import { BadRequestException } from '@nestjs/common';

/** Tolerância antes de dar falta: o cliente ainda pode chegar */
export const NO_SHOW_GRACE_MINUTES = 5;

export const NO_SHOW_TOO_EARLY_MESSAGE = `Só dá para marcar falta ${NO_SHOW_GRACE_MINUTES} minutos depois do início do horário. Antes disso, cancele o horário (o cliente é avisado).`;
export const COMPLETED_TOO_EARLY_MESSAGE =
  'Só dá para marcar como concluído depois do início do horário. Antes disso, cancele ou remarque.';

/**
 * "Faltou" e "concluído" só valem para horário que já começou (item 260).
 * Antes, a equipe marcava falta num horário de amanhã: registrava a taxa de
 * falta, contava na nota do cliente e liberava o horário sem avisar ninguém.
 */
export function assertStatusFitsTime(status: string, startAt: Date, now = new Date()) {
  if (status === 'NO_SHOW' && now.getTime() < startAt.getTime() + NO_SHOW_GRACE_MINUTES * 60_000) {
    throw new BadRequestException(NO_SHOW_TOO_EARLY_MESSAGE);
  }
  if (status === 'COMPLETED' && now.getTime() < startAt.getTime()) {
    throw new BadRequestException(COMPLETED_TOO_EARLY_MESSAGE);
  }
}
