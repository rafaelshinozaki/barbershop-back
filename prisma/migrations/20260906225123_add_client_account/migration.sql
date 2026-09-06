-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "clientAccountId" INTEGER;

-- CreateTable
CREATE TABLE "ClientAccount" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,

    CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFavorite" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAccountId" INTEGER NOT NULL,
    "networkId" INTEGER NOT NULL,

    CONSTRAINT "ClientFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_email_key" ON "ClientAccount"("email");

-- CreateIndex
CREATE INDEX "ClientFavorite_networkId_idx" ON "ClientFavorite"("networkId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFavorite_clientAccountId_networkId_key" ON "ClientFavorite"("clientAccountId", "networkId");

-- CreateIndex
CREATE INDEX "Customer_clientAccountId_idx" ON "Customer"("clientAccountId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFavorite" ADD CONSTRAINT "ClientFavorite_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFavorite" ADD CONSTRAINT "ClientFavorite_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;
