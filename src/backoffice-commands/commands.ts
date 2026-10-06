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
