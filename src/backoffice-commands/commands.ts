import { isLocalized, type Localized } from '../email/language';
import { safeAppLink } from '../common/app-urls';

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

/**
 * Conta de cliente suspensa pela API do backoffice: o back cancela o clube
 * (se foi pedido) e avisa a pessoa. Sem os campos, cancela no fim do período.
 */
export const CLIENT_SUSPENDED_EMAIL = 'client.suspended_email';
export type ClientSuspendedEmailCommand = {
  clientAccountId: number;
  cancelSubscriptions?: boolean;
  refundUnused?: boolean;
};

const MAX_REPLY = 5000;
const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

export function parseSupportReplyEmail(data: unknown): SupportReplyEmailCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.ticketId)) throw new Error('support.reply_email: pedido inválido');
  const reply = typeof d.reply === 'string' ? d.reply.trim() : '';
  if (!reply || reply.length > MAX_REPLY) throw new Error('support.reply_email: resposta inválida');
  return { ticketId: d.ticketId, reply };
}

/**
 * Unidade, rede ou dono saiu do ar pela API do backoffice (o banco já
 * mudou). O back pausa a cobrança do clube na Stripe, marca o motivo e
 * avisa quem assina. Tirar a suspensão retoma só esse motivo.
 */
export const CLUB_BILLING_PAUSE = 'club.billing_pause';
export type ClubBillingPauseCommand = {
  reason: 'platform_shop' | 'platform_network' | 'owner_inactive';
  targetId: number;
  paused: boolean;
};

const CLUB_PAUSE_REASONS: ClubBillingPauseCommand['reason'][] = [
  'platform_shop',
  'platform_network',
  'owner_inactive',
];

export function parseClubBillingPause(data: unknown): ClubBillingPauseCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!CLUB_PAUSE_REASONS.includes(d.reason as ClubBillingPauseCommand['reason']))
    throw new Error(`${CLUB_BILLING_PAUSE}: motivo inválido`);
  if (!positiveInt(d.targetId)) throw new Error(`${CLUB_BILLING_PAUSE}: alvo inválido`);
  if (typeof d.paused !== 'boolean') throw new Error(`${CLUB_BILLING_PAUSE}: ação inválida`);
  return {
    reason: d.reason as ClubBillingPauseCommand['reason'],
    targetId: d.targetId,
    paused: d.paused,
  };
}

export function parseClientSuspendedEmail(data: unknown): ClientSuspendedEmailCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.clientAccountId)) throw new Error('client.suspended_email: conta inválida');
  return {
    clientAccountId: d.clientAccountId,
    ...(typeof d.cancelSubscriptions === 'boolean'
      ? { cancelSubscriptions: d.cancelSubscriptions }
      : {}),
    ...(typeof d.refundUnused === 'boolean' ? { refundUnused: d.refundUnused } : {}),
  };
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
  // Só link do próprio app (o backoffice-back já confere; aqui de novo)
  const actionUrl = safeAppLink(text(d.actionUrl, 2000));
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

/**
 * A moderação (agora na API do backoffice) ocultou ou devolveu uma foto, uma
 * imagem da página (capa, logo, foto do profissional, post), a página de uma
 * unidade ou o perfil de um profissional: o back avisa o dono (sininho e celular).
 */
export const MODERATION_NOTIFY_OWNER = 'moderation.notify_owner';
const OWNER_TARGETS = [
  'photo',
  'barbershop',
  'professional_profile',
  'shop_cover',
  'shop_logo',
  'barber_photo',
  'social_post',
] as const;
export type ModerationNotifyOwnerCommand = {
  targetType: (typeof OWNER_TARGETS)[number];
  targetId: number;
  action: 'hide' | 'restore';
};

export function parseModerationNotifyOwner(data: unknown): ModerationNotifyOwnerCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!OWNER_TARGETS.includes(d.targetType as ModerationNotifyOwnerCommand['targetType']))
    throw new Error(`${MODERATION_NOTIFY_OWNER}: tipo inválido`);
  if (!positiveInt(d.targetId)) throw new Error(`${MODERATION_NOTIFY_OWNER}: conteúdo inválido`);
  if (d.action !== 'hide' && d.action !== 'restore')
    throw new Error(`${MODERATION_NOTIFY_OWNER}: ação inválida`);
  return {
    targetType: d.targetType as ModerationNotifyOwnerCommand['targetType'],
    targetId: d.targetId,
    action: d.action,
  };
}

/**
 * Pedido de confirmação aprovado pela API do backoffice (já marcado
 * executing lá): o back executa a ação (apagar conta, estorno, e-mail em
 * massa) e grava executed ou failed.
 */
export const APPROVAL_EXECUTE = 'approval.execute';
export type ApprovalExecuteCommand = { approvalId: number };

export function parseApprovalExecute(data: unknown): ApprovalExecuteCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.approvalId)) throw new Error(`${APPROVAL_EXECUTE}: pedido inválido`);
  return { approvalId: d.approvalId };
}

/**
 * Plano trocado pela API do backoffice (Financeiro, um a um ou em lote): o
 * back passa a assinatura antiga da Stripe pro preço do plano novo. Sem isso
 * quem foi rebaixado continuava pagando o plano maior (e o contrário).
 */
export const PLAN_SYNC_STRIPE = 'plan.sync_stripe';
export type PlanSyncStripeCommand = { userIds: number[] };

export function parsePlanSyncStripe(data: unknown): PlanSyncStripeCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  return { userIds: userIdsOf(PLAN_SYNC_STRIPE, d.userIds) };
}

/** Equipe: cancelar o plano no fim do período, ou desfazer isso. */
export const PLAN_PERIOD = 'plan.period';
export type PlanPeriodCommand = { userId: number; cancel: boolean };

export function parsePlanPeriod(data: unknown): PlanPeriodCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.userId)) throw new Error(`${PLAN_PERIOD}: pessoa inválida`);
  if (typeof d.cancel !== 'boolean') throw new Error(`${PLAN_PERIOD}: ação inválida`);
  return { userId: d.userId, cancel: d.cancel };
}

/** Equipe: estornar uma cobrança de plano já paga. */
export const PLAN_REFUND = 'plan.refund';
export type PlanRefundCommand = { paymentId: number };

export function parsePlanRefund(data: unknown): PlanRefundCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!positiveInt(d.paymentId)) throw new Error(`${PLAN_REFUND}: cobrança inválida`);
  return { paymentId: d.paymentId };
}

/** Equipe: reenviar e-mail de conta (senha, confirmação do cliente ou convite). */
export const ACCOUNT_RESEND = 'account.resend';
export type AccountResendCommand = {
  kind: 'password' | 'client_verify' | 'invite';
  email?: string;
  clientAccountId?: number;
  inviteId?: number;
};

export function parseAccountResend(data: unknown): AccountResendCommand {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.kind === 'password') {
    if (typeof d.email !== 'string' || !d.email.includes('@'))
      throw new Error(`${ACCOUNT_RESEND}: e-mail inválido`);
    return { kind: 'password', email: d.email };
  }
  if (d.kind === 'client_verify') {
    if (!positiveInt(d.clientAccountId)) throw new Error(`${ACCOUNT_RESEND}: conta inválida`);
    return { kind: 'client_verify', clientAccountId: d.clientAccountId };
  }
  if (d.kind === 'invite') {
    if (!positiveInt(d.inviteId)) throw new Error(`${ACCOUNT_RESEND}: convite inválido`);
    return { kind: 'invite', inviteId: d.inviteId };
  }
  throw new Error(`${ACCOUNT_RESEND}: tipo inválido`);
}
