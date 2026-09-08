-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "barberId" INTEGER,
    "serviceId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaitlistEntry_barbershopId_status_date_idx" ON "WaitlistEntry"("barbershopId", "status", "date");

-- CreateIndex
CREATE INDEX "WaitlistEntry_customerId_idx" ON "WaitlistEntry"("customerId");

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE SET NULL ON UPDATE CASCADE;
