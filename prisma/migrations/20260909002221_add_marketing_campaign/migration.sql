-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "inactiveDays" INTEGER,
    "sentByEmail" BOOLEAN NOT NULL DEFAULT false,
    "sentByWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "recipientCount" INTEGER NOT NULL,
    "emailSentCount" INTEGER NOT NULL DEFAULT 0,
    "whatsappSentCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingCampaign_barbershopId_createdAt_idx" ON "MarketingCampaign"("barbershopId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
