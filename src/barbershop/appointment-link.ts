import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Link "gerenciar agendamento" dos e-mails de confirmação e lembrete:
 * "<id>.<versão>.<assinatura>". Como no Booksy, o cliente cancela ou
 * remarca pelo link, sem login. A assinatura (HMAC com o segredo do
 * servidor) impede trocar o id. A versão sobe quando a unidade cancela, e
 * o link deixa de abrir 14 dias depois do atendimento (avaliação: 30).
 */
function secret() {
  const value = process.env.APPOINTMENT_LINK_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('APPOINTMENT_LINK_SECRET (ou JWT_SECRET) não configurado');
  return value;
}

/** Chat e página de gerenciar: até este prazo depois do fim do atendimento. */
export const MANAGE_LINK_DAYS = 14;
/** Avaliação pelo link do e-mail: até 30 dias depois do atendimento. */
export const REVIEW_LINK_DAYS = 30;
const DAY_MS = 86_400_000;

// Cada link tem o seu propósito na assinatura: o de avaliar não serve pra
// cancelar/remarcar, e vice-versa
type Purpose = 'appointment-manage' | 'appointment-review' | 'support-ticket' | 'waitlist-leave';

function sign(appointmentId: number, purpose: Purpose, version?: number) {
  const payload =
    version == null ? `${purpose}:${appointmentId}` : `${purpose}:${appointmentId}:${version}`;
  return createHmac('sha256', secret()).update(payload).digest('base64url').slice(0, 32);
}

function safeEqual(expected: string, given: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AppointmentLink = { id: number; version: number };

/**
 * Lê o link de gerenciar ou de avaliar. O formato atual é
 * "<id>.<versão>.<assinatura>". O antigo ("<id>.<assinatura>", sem versão)
 * vale como versão 0: some quando a versão do atendimento sobe.
 */
export function readAppointmentLink(
  token: string | undefined | null,
  purpose: 'appointment-manage' | 'appointment-review',
): AppointmentLink | null {
  const raw = (token ?? '').trim();
  const current = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]{32})$/.exec(raw);
  if (current) {
    const id = Number(current[1]);
    const version = Number(current[2]);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(version)) return null;
    return safeEqual(sign(id, purpose, version), current[3]) ? { id, version } : null;
  }
  const legacy = /^(\d+)\.([A-Za-z0-9_-]{32})$/.exec(raw);
  if (!legacy) return null;
  const id = Number(legacy[1]);
  if (!Number.isSafeInteger(id)) return null;
  return safeEqual(sign(id, purpose), legacy[2]) ? { id, version: 0 } : null;
}

/** O link ainda abre este atendimento: versão igual e dentro do prazo. */
export function appointmentLinkCovers(
  token: string | undefined | null,
  purpose: 'appointment-manage' | 'appointment-review',
  appointment: { id: number; endAt: Date; linkVersion: number },
  now = new Date(),
): boolean {
  const parsed = readAppointmentLink(token, purpose);
  if (!parsed || parsed.id !== appointment.id || parsed.version !== appointment.linkVersion) {
    return false;
  }
  const days = purpose === 'appointment-review' ? REVIEW_LINK_DAYS : MANAGE_LINK_DAYS;
  return now.getTime() <= appointment.endAt.getTime() + days * DAY_MS;
}

function verify(token: string | undefined | null, purpose: Purpose): number | null {
  const match = /^(\d+)\.([A-Za-z0-9_-]{32})$/.exec((token ?? '').trim());
  if (!match) return null;
  const appointmentId = Number(match[1]);
  if (!Number.isSafeInteger(appointmentId)) return null;
  return safeEqual(sign(appointmentId, purpose), match[2]) ? appointmentId : null;
}

export function createAppointmentToken(appointmentId: number, version = 0): string {
  return `${appointmentId}.${version}.${sign(appointmentId, 'appointment-manage', version)}`;
}

/** Id do agendamento se a assinatura bater; null se não. O prazo é conferido com o atendimento. */
export function verifyAppointmentToken(token: string | undefined | null): number | null {
  return readAppointmentLink(token, 'appointment-manage')?.id ?? null;
}

/** Link "como foi?" do e-mail pós-atendimento: avaliar sem login. */
export function createReviewToken(appointmentId: number, version = 0): string {
  return `${appointmentId}.${version}.${sign(appointmentId, 'appointment-review', version)}`;
}

export function verifyReviewToken(token: string | undefined | null): number | null {
  return readAppointmentLink(token, 'appointment-review')?.id ?? null;
}

export function appointmentReviewUrl(
  appointmentId: number,
  rating?: number,
  version = 0,
): string {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  const t = encodeURIComponent(createReviewToken(appointmentId, version));
  return `${front}/review?t=${t}${rating ? `&r=${rating}` : ''}`;
}

/** Página do front onde o cliente vê, cancela ou remarca o horário. */
export function appointmentManageUrl(appointmentId: number, version = 0): string {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${front}/booking/manage?t=${encodeURIComponent(createAppointmentToken(appointmentId, version))}`;
}

/** Link do pedido de suporte: quem pediu acompanha e responde sem login */
export function createSupportToken(ticketId: number): string {
  return `${ticketId}.${sign(ticketId, 'support-ticket')}`;
}

export function verifySupportToken(token: string | undefined | null): number | null {
  return verify(token, 'support-ticket');
}

export function supportTicketUrl(ticketId: number): string {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${front}/support/ticket?t=${encodeURIComponent(createSupportToken(ticketId))}`;
}

/** Link "sair da lista de espera" do e-mail de quem entrou pela tela de agendamento */
export function createWaitlistLeaveToken(entryId: number): string {
  return `${entryId}.${sign(entryId, 'waitlist-leave')}`;
}

export function verifyWaitlistLeaveToken(token: string | undefined | null): number | null {
  return verify(token, 'waitlist-leave');
}

export function waitlistLeaveUrl(entryId: number): string {
  const front = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${front}/waitlist/leave?t=${encodeURIComponent(createWaitlistLeaveToken(entryId))}`;
}
