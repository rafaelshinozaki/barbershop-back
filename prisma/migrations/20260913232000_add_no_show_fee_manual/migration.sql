-- CreateTable
CREATE TABLE "NoShowFee" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "NoShowFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoShowFee_appointmentId_key" ON "NoShowFee"("appointmentId");

-- CreateIndex
CREATE INDEX "NoShowFee_barbershopId_idx" ON "NoShowFee"("barbershopId");

-- CreateIndex
CREATE INDEX "NoShowFee_customerId_idx" ON "NoShowFee"("customerId");

-- AddForeignKey
ALTER TABLE "NoShowFee" ADD CONSTRAINT "NoShowFee_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowFee" ADD CONSTRAINT "NoShowFee_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoShowFee" ADD CONSTRAINT "NoShowFee_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

