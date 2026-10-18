-- Taxa da plataforma gravada em cada aluguel pago por cartão
ALTER TABLE "ChairRentPayment" ADD COLUMN "platformFeePercent" DECIMAL(65,30);

-- Repasse manual do aluguel da cadeira ao espaço (item 178)
CREATE TABLE "ChairRentPayout" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedByEmail" TEXT NOT NULL,

    CONSTRAINT "ChairRentPayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChairRentPayout_barbershopId_paidAt_idx" ON "ChairRentPayout"("barbershopId", "paidAt");

ALTER TABLE "ChairRentPayout" ADD CONSTRAINT "ChairRentPayout_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
