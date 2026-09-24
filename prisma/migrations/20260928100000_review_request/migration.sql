-- Pedido de avaliação depois do atendimento: avaliação pelo link do e-mail,
-- sem conta de cliente (ligada à ficha do cliente)

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "reviewRequestSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Review" ALTER COLUMN "clientAccountId" DROP NOT NULL,
ADD COLUMN "customerId" INTEGER;

-- CreateIndex
CREATE INDEX "Appointment_status_reviewRequestSentAt_endAt_idx" ON "Appointment"("status", "reviewRequestSentAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_barbershopId_customerId_key" ON "Review"("barbershopId", "customerId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
