-- Taxa do sinal na hora do pagamento, e o repasse manual do que ficou na plataforma.
ALTER TABLE "Appointment" ADD COLUMN "depositPlatformFeePercent" DECIMAL(65,30);

CREATE TABLE "DepositPayout" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedByEmail" TEXT NOT NULL,

    CONSTRAINT "DepositPayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DepositPayout_barbershopId_paidAt_idx" ON "DepositPayout"("barbershopId", "paidAt");

ALTER TABLE "DepositPayout" ADD CONSTRAINT "DepositPayout_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
