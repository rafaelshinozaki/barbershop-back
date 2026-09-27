-- AlterTable
ALTER TABLE "ChatThread" ADD COLUMN     "closedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedByUserId" INTEGER,
ADD COLUMN     "blockedReason" TEXT;
