-- AlterTable
ALTER TABLE "ChairRentPayment" ADD COLUMN     "cashSessionId" INTEGER,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "memberExpenseId" INTEGER,
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'CARD',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "recordedByUserId" INTEGER,
ALTER COLUMN "stripeInvoiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SharedLocationMember" ADD COLUMN     "rentBillingMode" TEXT NOT NULL DEFAULT 'CARD',
ADD COLUMN     "rentStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ChairRentPayment_cashSessionId_idx" ON "ChairRentPayment"("cashSessionId");

-- CreateIndex
CREATE INDEX "ChairRentPayment_status_dueDate_idx" ON "ChairRentPayment"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChairRentPayment_sharedLocationMemberId_dueDate_key" ON "ChairRentPayment"("sharedLocationMemberId", "dueDate");


-- Pagamentos de cartão já registrados: pagos na data do registro
UPDATE "ChairRentPayment" SET "paidAt" = "createdAt" WHERE "status" = 'SUCCEEDED' AND "paidAt" IS NULL;
