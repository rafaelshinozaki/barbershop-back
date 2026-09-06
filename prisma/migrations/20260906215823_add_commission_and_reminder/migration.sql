-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "barberId" INTEGER,
    "itemType" TEXT NOT NULL DEFAULT 'ALL',
    "percentage" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRule_barbershopId_idx" ON "CommissionRule"("barbershopId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_barbershopId_barberId_itemType_key" ON "CommissionRule"("barbershopId", "barberId", "itemType");

-- CreateIndex
CREATE INDEX "Appointment_status_reminderSentAt_startAt_idx" ON "Appointment"("status", "reminderSentAt", "startAt");

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
