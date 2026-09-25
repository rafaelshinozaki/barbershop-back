-- Estorno do sinal pago online
ALTER TABLE "Appointment" ADD COLUMN "depositRefundedAt" TIMESTAMP(3);
