-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "depositAmount" DECIMAL(65,30),
ADD COLUMN     "depositPaid" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BarbershopService" ADD COLUMN     "depositAmount" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Network" ADD COLUMN     "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyaltyPointValue" DOUBLE PRECISION,
ADD COLUMN     "loyaltyPointsPerCurrencyUnit" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "giftCardAmountApplied" DECIMAL(65,30),
ADD COLUMN     "giftCardId" INTEGER,
ADD COLUMN     "loyaltyDiscountAmount" DECIMAL(65,30),
ADD COLUMN     "loyaltyPointsEarned" INTEGER,
ADD COLUMN     "loyaltyPointsRedeemed" INTEGER;

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "networkId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "initialValue" DECIMAL(65,30) NOT NULL,
    "remainingValue" DECIMAL(65,30) NOT NULL,
    "purchaserName" TEXT,
    "purchaserPhone" TEXT,
    "purchaserEmail" TEXT,
    "recipientName" TEXT,
    "message" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "GiftCard_networkId_idx" ON "GiftCard"("networkId");

-- CreateIndex
CREATE INDEX "Sale_giftCardId_idx" ON "Sale"("giftCardId");

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
