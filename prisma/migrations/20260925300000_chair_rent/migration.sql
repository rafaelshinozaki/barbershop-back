-- AlterTable
ALTER TABLE "SharedLocationMember" ADD COLUMN     "rentAmount" DECIMAL(65,30),
ADD COLUMN     "rentCurrency" TEXT,
ADD COLUMN     "rentPaidUntil" TIMESTAMP(3),
ADD COLUMN     "rentPayerUserId" INTEGER,
ADD COLUMN     "rentStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "rentStripePriceId" TEXT,
ADD COLUMN     "rentStripeSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "ChairRentPayment" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sharedLocationMemberId" INTEGER NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "receiptUrl" TEXT,
    "receiptPdfUrl" TEXT,

    CONSTRAINT "ChairRentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChairRentPayment_stripeInvoiceId_key" ON "ChairRentPayment"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "ChairRentPayment_sharedLocationMemberId_idx" ON "ChairRentPayment"("sharedLocationMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedLocationMember_rentStripeSubscriptionId_key" ON "SharedLocationMember"("rentStripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "ChairRentPayment" ADD CONSTRAINT "ChairRentPayment_sharedLocationMemberId_fkey" FOREIGN KEY ("sharedLocationMemberId") REFERENCES "SharedLocationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

