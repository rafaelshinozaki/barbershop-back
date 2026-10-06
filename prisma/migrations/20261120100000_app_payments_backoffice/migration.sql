-- AlterTable
ALTER TABLE "AppointmentTip" ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentDispute" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "evidenceDueBy" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDispute_stripeDisputeId_key" ON "PaymentDispute"("stripeDisputeId");

-- CreateIndex
CREATE INDEX "PaymentDispute_stripePaymentIntentId_idx" ON "PaymentDispute"("stripePaymentIntentId");

