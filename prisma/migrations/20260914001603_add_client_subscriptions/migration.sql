-- AlterTable
ALTER TABLE "ClientAccount" ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "ClientSubscriptionPlan" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "sessionsPerCycle" INTEGER,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ClientSubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "clientAccountId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "usedThisCycle" INTEGER NOT NULL DEFAULT 0,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubscriptionPayment" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionId" INTEGER NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),

    CONSTRAINT "ClientSubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientSubscriptionPlan_barbershopId_idx" ON "ClientSubscriptionPlan"("barbershopId");

-- CreateIndex
CREATE INDEX "ClientSubscriptionPlan_barbershopId_isActive_idx" ON "ClientSubscriptionPlan"("barbershopId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSubscription_stripeSubscriptionId_key" ON "ClientSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "ClientSubscription_barbershopId_idx" ON "ClientSubscription"("barbershopId");

-- CreateIndex
CREATE INDEX "ClientSubscription_clientAccountId_idx" ON "ClientSubscription"("clientAccountId");

-- CreateIndex
CREATE INDEX "ClientSubscription_barbershopId_status_idx" ON "ClientSubscription"("barbershopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSubscriptionPayment_stripeInvoiceId_key" ON "ClientSubscriptionPayment"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "ClientSubscriptionPayment_subscriptionId_idx" ON "ClientSubscriptionPayment"("subscriptionId");

-- AddForeignKey
ALTER TABLE "ClientSubscriptionPlan" ADD CONSTRAINT "ClientSubscriptionPlan_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscriptionPlan" ADD CONSTRAINT "ClientSubscriptionPlan_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ClientSubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscriptionPayment" ADD CONSTRAINT "ClientSubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

