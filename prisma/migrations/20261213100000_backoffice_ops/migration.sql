-- Operações do backoffice (P1): suspensão da unidade ou da rede, responsável
-- do pedido de suporte e nota interna da equipe.

ALTER TABLE "Barbershop" ADD COLUMN "platformSuspendedAt" TIMESTAMP(3),
  ADD COLUMN "platformSuspendedReason" TEXT;

ALTER TABLE "Network" ADD COLUMN "platformSuspendedAt" TIMESTAMP(3),
  ADD COLUMN "platformSuspendedReason" TEXT;

ALTER TABLE "SupportTicket" ADD COLUMN "assigneeEmail" TEXT;

CREATE INDEX "SupportTicket_assigneeEmail_idx" ON "SupportTicket"("assigneeEmail");

CREATE TABLE "StaffNote" (
  "id" SERIAL NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "targetType" TEXT NOT NULL,
  "targetId" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "authorEmail" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  CONSTRAINT "StaffNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffNote_targetType_targetId_createdAt_idx" ON "StaffNote"("targetType", "targetId", "createdAt");
