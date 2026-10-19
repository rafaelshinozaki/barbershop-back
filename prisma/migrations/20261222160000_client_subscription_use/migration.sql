-- CreateTable
CREATE TABLE "ClientSubscriptionUse" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientSubscriptionId" INTEGER NOT NULL,
    "saleId" INTEGER,
    "usedByUserId" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "undoneByUserId" INTEGER,

    CONSTRAINT "ClientSubscriptionUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientSubscriptionUse_clientSubscriptionId_idx" ON "ClientSubscriptionUse"("clientSubscriptionId");

-- CreateIndex
CREATE INDEX "ClientSubscriptionUse_saleId_idx" ON "ClientSubscriptionUse"("saleId");

-- AddForeignKey
ALTER TABLE "ClientSubscriptionUse" ADD CONSTRAINT "ClientSubscriptionUse_clientSubscriptionId_fkey" FOREIGN KEY ("clientSubscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
