-- CreateTable
CREATE TABLE "BackofficeAuditLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "area" TEXT,
    "args" JSONB,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,

    CONSTRAINT "BackofficeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_createdAt_idx" ON "BackofficeAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_actorId_idx" ON "BackofficeAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "BackofficeAuditLog_operation_idx" ON "BackofficeAuditLog"("operation");
