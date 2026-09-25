-- Sinal pago online (Stripe) ao agendar pela página pública

-- AlterTable
ALTER TABLE "Barbershop" ADD COLUMN "onlineDeposit" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "depositPaidAt" TIMESTAMP(3),
ADD COLUMN "depositPaymentIntentId" TEXT,
ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_depositPaymentIntentId_key" ON "Appointment"("depositPaymentIntentId");

-- CreateIndex
CREATE INDEX "Appointment_status_holdExpiresAt_idx" ON "Appointment"("status", "holdExpiresAt");
