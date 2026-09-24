-- CreateTable
CREATE TABLE "BarberPayConfig" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "barberId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "payType" TEXT NOT NULL DEFAULT 'COMMISSION',
    "fixedAmount" DECIMAL(65,30),
    "payPeriod" TEXT NOT NULL DEFAULT 'MONTHLY',

    CONSTRAINT "BarberPayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarberPayEntry" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "barberId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "method" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "payoutId" INTEGER,
    "expenseId" INTEGER,
    "cashSessionId" INTEGER,
    "createdByUserId" INTEGER NOT NULL,

    CONSTRAINT "BarberPayEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarberPayout" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "barberId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payType" TEXT NOT NULL,
    "serviceSales" DECIMAL(65,30) NOT NULL,
    "productSales" DECIMAL(65,30) NOT NULL,
    "salesCount" INTEGER NOT NULL,
    "commission" DECIMAL(65,30) NOT NULL,
    "fixedAmount" DECIMAL(65,30) NOT NULL,
    "baseAmount" DECIMAL(65,30) NOT NULL,
    "tips" DECIMAL(65,30) NOT NULL,
    "bonuses" DECIMAL(65,30) NOT NULL,
    "deductions" DECIMAL(65,30) NOT NULL,
    "advances" DECIMAL(65,30) NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "expenseId" INTEGER,
    "cashSessionId" INTEGER,
    "carryOverEntryId" INTEGER,
    "createdByUserId" INTEGER NOT NULL,

    CONSTRAINT "BarberPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BarberPayConfig_barberId_key" ON "BarberPayConfig"("barberId");

-- CreateIndex
CREATE INDEX "BarberPayConfig_barbershopId_idx" ON "BarberPayConfig"("barbershopId");

-- CreateIndex
CREATE INDEX "BarberPayEntry_barbershopId_barberId_date_idx" ON "BarberPayEntry"("barbershopId", "barberId", "date");

-- CreateIndex
CREATE INDEX "BarberPayEntry_payoutId_idx" ON "BarberPayEntry"("payoutId");

-- CreateIndex
CREATE INDEX "BarberPayout_barbershopId_paidAt_idx" ON "BarberPayout"("barbershopId", "paidAt");

-- CreateIndex
CREATE INDEX "BarberPayout_barberId_periodStart_idx" ON "BarberPayout"("barberId", "periodStart");

-- AddForeignKey
ALTER TABLE "BarberPayConfig" ADD CONSTRAINT "BarberPayConfig_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayConfig" ADD CONSTRAINT "BarberPayConfig_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayEntry" ADD CONSTRAINT "BarberPayEntry_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayEntry" ADD CONSTRAINT "BarberPayEntry_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayEntry" ADD CONSTRAINT "BarberPayEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "BarberPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayout" ADD CONSTRAINT "BarberPayout_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarberPayout" ADD CONSTRAINT "BarberPayout_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

