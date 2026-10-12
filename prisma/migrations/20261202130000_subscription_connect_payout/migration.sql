-- Assinatura do clube na conta conectada, e o repasse manual do que ficou na plataforma.
ALTER TABLE "ClientSubscription" ADD COLUMN "connectAccountId" TEXT;
ALTER TABLE "ClientSubscription" ADD COLUMN "applicationFeePercent" DECIMAL(65,30);

ALTER TABLE "ClientSubscriptionPayment" ADD COLUMN "settledViaConnect" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SubscriptionPayout" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedByEmail" TEXT NOT NULL,

    CONSTRAINT "SubscriptionPayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionPayout_barbershopId_paidAt_idx" ON "SubscriptionPayout"("barbershopId", "paidAt");

ALTER TABLE "SubscriptionPayout" ADD CONSTRAINT "SubscriptionPayout_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
