-- AlterTable
ALTER TABLE "Professional" ADD COLUMN     "offersHomeService" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastErrorCode" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityVerification_sessionId_key" ON "IdentityVerification"("sessionId");

-- CreateIndex
CREATE INDEX "IdentityVerification_userId_createdAt_idx" ON "IdentityVerification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
