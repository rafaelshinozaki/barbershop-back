-- CreateTable
CREATE TABLE "FeaturedPurchase" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paidAt" TIMESTAMP(3),
    "featuredUntil" TIMESTAMP(3),

    CONSTRAINT "FeaturedPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedPurchase_stripePaymentIntentId_key" ON "FeaturedPurchase"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "FeaturedPurchase_ownerType_ownerId_status_idx" ON "FeaturedPurchase"("ownerType", "ownerId", "status");

-- CreateIndex
CREATE INDEX "FeaturedPurchase_userId_idx" ON "FeaturedPurchase"("userId");

