import { isLocalized, type Localized } from '../email/language';

/**
 * Contrato dos comandos que a API do backoffice manda pela fila
 * BACKOFFICE_COMMANDS_QUEUE (mesmo Redis). O backoffice-back só monta o
 * comando; o back confere e executa. Mudou aqui, muda lá (o teste de
 * contrato do backoffice-back usa estes nomes).
 */
export const EMAIL_SEND = 'email.send';

/** Templates que a API do backoffice pode mandar (nada de e-mail livre) */
export const BACKOFFICE_EMAIL_TEMPLATES = [
  // Código do login em duas etapas da equipe
  'verification_code',
  // Convite para a equipe da plataforma
  'staff_invite',
  // Redefinir a senha da equipe
  'password_reset',
  // Cargo da pessoa mudou (Equipe)
  'staff_role_changed',
] as const;
export type BackofficeEmailTemplate = (typeof BACKOFFICE_EMAIL_TEMPLATES)[number];

export type EmailSendCommand = {
  to: string;
  template: BackofficeEmailTemplate;
  lang: 'pt' | 'en' | 'es';
  subject: string | Localized;
  /** Só texto e número (vão para o template) */
  context: Record<string, string | number>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Confere o comando; formato errado vira erro (o job falha e aparece) */
export function parseEmailSend(data: unknown): EmailSendCommand {
  if (!data || typeof data !== 'object') throw new Error('email.send: comando vazio');
  const d = data as Record<string, unknown>;
  if (typeof d.to !== 'string' || !EMAIL.test(d.to) || d.to.length > 254)
    throw new Error('email.send: destinatário inválido');
  if (!BACKOFFICE_EMAIL_TEMPLATES.includes(d.template as BackofficeEmailTemplate))
    throw new Error(`email.send: template não permitido (${String(d.template)})`);
  const lang = d.lang === 'en' || d.lang === 'es' ? d.lang : 'pt';
  const subject = d.subject;
  if (!(typeof subject === 'string' && subject.trim()) && !isLocalized(subject))
    throw new Error('email.send: assunto inválido');
  const context: Record<string, string | number> = {};
  if (d.context && typeof d.context === 'object') {
    for (const [k, v] of Object.entries(d.context as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
      if (typeof v === 'string') context[k] = v.slice(0, 2000);
      else if (typeof v === 'number' && Number.isFinite(v)) context[k] = v;
    }
  }
  return {
    to: d.to,
    template: d.template as BackofficeEmailTemplate,
    lang,
    subject: subject as string | Localized,
    context,
  };
}

/**
 * Resposta do suporte já gravada pela API do backoffice: o back manda o
 * e-mail pra quem pediu (com o link assinado do pedido, que só o back sabe
 * fazer).
 */
export const SUPPORT_REPLY_EMAIL = 'support.reply_email';
export type SupportReplyEmailCommand = { ticketId: number; reply: string };

/** Conta de cliente suspensa pela API do backoffice: o back avisa a pessoa */
export const CLIENT_SUSPENDED_EMAIL = 'client.suspended_email';
export type ClientSuspendedEmailCommand = { clientAccountId: number };

const MAX_REPLY = 5000;
const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export function parseSupportReplyEmail(data: unknown): SupportReplyEmailCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.ticketId)) throw new Error('support.reply_email: pedido inválido');
  const reply = typeof d.reply === 'string' ? d.reply.trim() : '';
  if (!reply || reply.length > MAX_REPLY) throw new Error('support.reply_email: resposta inválida');
  return { ticketId: d.ticketId, reply };
}

export function parseClientSuspendedEmail(data: unknown): ClientSuspendedEmailCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.clientAccountId)) throw new Error('client.suspended_email: conta inválida');
  return { clientAccountId: d.clientAccountId };
}

/**
 * Destaque de profissional mudado pela API do backoffice: a busca guarda
 * resultados em cache (Redis); o back renova pra o selo e a ordem valerem na
 * hora. Sem dados.
 */
export const SEARCH_CACHE_BUMP = 'search.cache_bump';

/**
 * Preços e taxas salvos pela API do backoffice: o back relê na hora (sem o
 * comando, as instâncias releem a cada minuto). Sem dados.
 */
export const PRICING_RELOAD = 'pricing.reload';

/**
 * Avisos (sininho) gravados pela API do backoffice: o back avisa as telas
 * abertas dessas pessoas (pub/sub daqui).
 */
export const NOTIFICATIONS_CREATED = 'notifications.created';
export type NotificationsCreatedCommand = { userIds: number[]; title: string };

/**
 * E-mail da equipe pra contas do app (template admin_notification): o back
 * monta no idioma de cada pessoa, manda e guarda no histórico. A API do
 * backoffice já conferiu a permissão e o limite (mais de 1.000 pessoas pede
 * confirmação).
 */
export const ADMIN_NOTIFICATION_EMAIL = 'email.admin_notification';
export type AdminNotificationEmailCommand = {
  userIds: number[];
  subject: string;
  message: string;
  actionUrl?: string;
  actionText?: string;
  type?: string;
};

/** Cada comando leva no máximo isso de pessoas (a API do backoffice manda em pedaços) */
const MAX_IDS = 1000;

function userIdsOf(name: string, v: unknown): number[] {
  if (!Array.isArray(v) || !v.length || v.length > MAX_IDS || !v.every(positiveInt))
    throw new Error(`${name}: pessoas inválidas`);
  return v;
}

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v : undefined;

export function parseNotificationsCreated(data: unknown): NotificationsCreatedCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  const userIds = userIdsOf(NOTIFICATIONS_CREATED, d.userIds);
  const title = text(d.title, 500);
  if (!title) throw new Error(`${NOTIFICATIONS_CREATED}: título inválido`);
  return { userIds, title };
}

export function parseAdminNotificationEmail(data: unknown): AdminNotificationEmailCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  const userIds = userIdsOf(ADMIN_NOTIFICATION_EMAIL, d.userIds);
  const subject = text(d.subject, 300);
  if (!subject) throw new Error(`${ADMIN_NOTIFICATION_EMAIL}: assunto inválido`);
  const message = text(d.message, 20000);
  if (!message) throw new Error(`${ADMIN_NOTIFICATION_EMAIL}: mensagem inválida`);
  const actionUrl = text(d.actionUrl, 2000);
  const actionText = text(d.actionText, 200);
  const type = text(d.type, 20);
  return {
    userIds,
    subject,
    message,
    ...(actionUrl ? { actionUrl } : {}),
    ...(actionText ? { actionText } : {}),
    ...(type ? { type } : {}),
  };
}
