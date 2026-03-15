// src/email/models/send-email.schema.ts
export type SendEmail = {
  to: string;
  subject: string;
  html: string;
  meta: string;
  from?: string; // torna o 'from' opcional
};
