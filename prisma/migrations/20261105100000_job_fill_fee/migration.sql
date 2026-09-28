-- AlterTable
ALTER TABLE "JobApplication" ADD COLUMN     "feeCents" INTEGER,
ADD COLUMN     "feePaidAt" TIMESTAMP(3),
ADD COLUMN     "feePayerUserId" INTEGER,
ADD COLUMN     "feePaymentIntentId" TEXT,
ADD COLUMN     "feeRefundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "JobApplication_feePaymentIntentId_key" ON "JobApplication"("feePaymentIntentId");

