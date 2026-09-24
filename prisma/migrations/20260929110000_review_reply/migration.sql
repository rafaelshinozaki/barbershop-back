-- Resposta da unidade às avaliações e denúncia pra moderação

-- AlterTable
ALTER TABLE "Review" ADD COLUMN "reply" TEXT,
ADD COLUMN "repliedAt" TIMESTAMP(3),
ADD COLUMN "repliedByUserId" INTEGER,
ADD COLUMN "reportedAt" TIMESTAMP(3),
ADD COLUMN "reportReason" TEXT,
ADD COLUMN "hiddenAt" TIMESTAMP(3);
