-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "depositStripeAccountId" TEXT;

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "createdByUserId" INTEGER,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_stripeAccountId_key" ON "PaymentAccount"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_ownerType_ownerId_key" ON "PaymentAccount"("ownerType", "ownerId");

