-- AlterTable
ALTER TABLE "Network" ADD COLUMN     "referralBonusPoints" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "CustomerReferral" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "networkId" INTEGER NOT NULL,
    "referrerId" INTEGER NOT NULL,
    "referredId" INTEGER NOT NULL,
    "pointsAwarded" INTEGER,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerReferral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReferral_referredId_key" ON "CustomerReferral"("referredId");

-- CreateIndex
CREATE INDEX "CustomerReferral_networkId_idx" ON "CustomerReferral"("networkId");

-- CreateIndex
CREATE INDEX "CustomerReferral_referrerId_idx" ON "CustomerReferral"("referrerId");

-- AddForeignKey
ALTER TABLE "CustomerReferral" ADD CONSTRAINT "CustomerReferral_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReferral" ADD CONSTRAINT "CustomerReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReferral" ADD CONSTRAINT "CustomerReferral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
