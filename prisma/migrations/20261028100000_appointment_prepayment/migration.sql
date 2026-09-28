-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "prepaidAmount" DECIMAL(65,30),
ADD COLUMN     "prepaidAt" TIMESTAMP(3),
ADD COLUMN     "prepaidPaymentIntentId" TEXT,
ADD COLUMN     "prepaidRefundedAt" TIMESTAMP(3),
ADD COLUMN     "prepaidStripeAccountId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "prepaidApplied" DECIMAL(65,30);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_prepaidPaymentIntentId_key" ON "Appointment"("prepaidPaymentIntentId");

