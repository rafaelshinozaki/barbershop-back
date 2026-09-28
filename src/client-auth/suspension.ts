import { ForbiddenException } from '@nestjs/common';

/** Sem 'token'/'Unauthorized' na mensagem: o front derrubaria a sessão da equipe ao lado */
export const SUSPENDED_MESSAGE =
  'Esta conta foi suspensa pela plataforma. Para saber mais, fale com o suporte.';

/** Conta de cliente suspensa pelo admin não entra (senha certa: diz o motivo) */
export function assertNotSuspended(account: { suspendedAt?: Date | null }) {
  if (account.suspendedAt) throw new ForbiddenException(SUSPENDED_MESSAGE);
}
