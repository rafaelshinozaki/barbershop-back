-- AlterTable
ALTER TABLE "ClientAccount" ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LinkedSocialAccount" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEmail" TEXT NOT NULL,

    CONSTRAINT "LinkedSocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLinkedSocialAccount" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAccountId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEmail" TEXT NOT NULL,

    CONSTRAINT "ClientLinkedSocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LinkedSocialAccount_userId_idx" ON "LinkedSocialAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedSocialAccount_userId_provider_key" ON "LinkedSocialAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedSocialAccount_provider_providerEmail_key" ON "LinkedSocialAccount"("provider", "providerEmail");

-- CreateIndex
CREATE INDEX "ClientLinkedSocialAccount_clientAccountId_idx" ON "ClientLinkedSocialAccount"("clientAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientLinkedSocialAccount_clientAccountId_provider_key" ON "ClientLinkedSocialAccount"("clientAccountId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ClientLinkedSocialAccount_provider_providerEmail_key" ON "ClientLinkedSocialAccount"("provider", "providerEmail");

-- AddForeignKey
ALTER TABLE "LinkedSocialAccount" ADD CONSTRAINT "LinkedSocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLinkedSocialAccount" ADD CONSTRAINT "ClientLinkedSocialAccount_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
