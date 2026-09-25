-- Agendamento recorrente: horários da mesma série

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "seriesId" TEXT,
ADD COLUMN "seriesIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Appointment_seriesId_idx" ON "Appointment"("seriesId");
