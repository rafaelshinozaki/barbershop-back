// Filas de envio (uma por provedor, cada uma com seu próprio limite de
// taxa) e filas de tarefas agendadas (substituem os @Cron, que rodavam em
// TODAS as instâncias e duplicavam lembretes/cobranças quando o back tinha
// mais de uma réplica — o agendador do BullMQ dispara um job só por vez,
// não importa quantas instâncias estejam consumindo).
export const EMAIL_QUEUE = 'email';
export const WHATSAPP_QUEUE = 'whatsapp';
export const APPOINTMENT_REMINDERS_QUEUE = 'appointment-reminders';
export const RECURRING_PAYMENTS_QUEUE = 'recurring-payments';
export const SOCIAL_POSTS_QUEUE = 'social-posts';
export const CHAIR_RENT_QUEUE = 'chair-rent';

// Tentativas com espera exponencial (30s, 1min, 2min, 4min, 8min) — cobre
// instabilidade do Mailgun/Meta sem martelar o provedor. Guarda histórico
// limitado no Redis.
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

// Tarefas agendadas: sem retry (a próxima execução já cobre o que faltou)
export const SCHEDULED_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 200 },
} as const;
