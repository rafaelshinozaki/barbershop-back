import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Link "gerenciar agendamento" dos e-mails de confirmação e lembrete:
 * "<appointmentId>.<assinatura>". Como no Booksy, o cliente cancela ou
 * remarca pelo link, sem login. A assinatura (HMAC com o segredo do
 * servidor) impede trocar o id e mexer no horário de outra pessoa; não
 * precisa de tabela, e o mesmo link sai na confirmação e no lembrete.
 */
function secret() {
  const value = process.env.APPOINTMENT_LINK_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('APPOINTMENT_LINK_SECRET (ou JWT_SECRET) não configurado');
  return value;
}

function sign(appointmentId: number) {
  return createHmac('sha256', secret())
    .update(`appointment-manage:${appointmentId}`)
    .digest('base64url')
    .slice(0, 32);
}

export function createAppointmentToken(appointmentId: number): string {
  return `${appointmentId}.${sign(appointmentId)}`;
}

/** Id do agendamento se o token for válido; null se não. */
export function verifyAppointmentToken(token: string | undefined | null): number | null {
  const match = /^(\d+)\.([A-Za-z0-9_-]{32})$/.exec((token ?? '').trim());
  if (!match) return null;
  const appointmentId = Number(match[1]);
  if (!Number.isSafeInteger(appointmentId)) return null;
  const expected = Buffer.from(sign(appointmentId));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? appointmentId
    : null;
}

/** Página do front onde o cliente vê, cancela ou remarca o horário. */
export function appointmentManageUrl(appointmentId: number): string {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${front}/booking/manage?t=${encodeURIComponent(createAppointmentToken(appointmentId))}`;
}
