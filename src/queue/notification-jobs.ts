import type {
  AppointmentReminderParams,
  WaitlistSlotAvailableParams,
} from '../whatsapp/whatsapp.service';
import type { Localized } from '../email/language';

/** E-mail pra um usuário com conta (idioma vem de UserSystemConfig). */
export interface UserEmailJob {
  kind: 'user';
  userId: number;
  template: string;
  context: Record<string, unknown>;
  subject: string | Localized;
  meta: string;
  to: string;
}

/** E-mail pra cliente final sem conta (lembrete, lista de espera, campanha). */
export interface CustomerEmailJob {
  kind: 'customer';
  loggedAgainstUserId: number;
  template: string;
  context: Record<string, unknown>;
  subject: string | Localized;
  meta: string;
  to: string;
  lang?: string;
  /** Quando é de uma campanha, o worker atualiza os contadores dela */
  campaignId?: number;
  /** Cabeçalhos extras (ex.: List-Unsubscribe da campanha) */
  headers?: Record<string, string>;
}

export type EmailJob = UserEmailJob | CustomerEmailJob;

export type WhatsappJob =
  | { kind: 'appointment-reminder'; to: string; params: AppointmentReminderParams }
  | { kind: 'waitlist-slot'; to: string; params: WaitlistSlotAvailableParams }
  | { kind: 'marketing'; to: string; message: string; campaignId?: number };
