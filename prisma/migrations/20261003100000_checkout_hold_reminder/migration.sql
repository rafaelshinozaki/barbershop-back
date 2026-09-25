-- Fechar a conta do horário (sinal descontado) e lembrete do sinal pendente
ALTER TABLE "Sale" ADD COLUMN "depositApplied" DECIMAL(65,30);

ALTER TABLE "Appointment" ADD COLUMN "holdReminderSentAt" TIMESTAMP(3);
