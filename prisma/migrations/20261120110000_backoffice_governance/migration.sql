-- CreateTable
CREATE TABLE "PrivacyRequest" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "userId" INTEGER,
    "clientAccountId" INTEGER,
    "supportTicketId" INTEGER,
    "details" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "response" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" INTEGER,
    "createdByEmail" TEXT NOT NULL,
    "resolvedById" INTEGER,
    "resolvedByEmail" TEXT,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackofficeApproval" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" INTEGER,
    "requestedByEmail" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "decidedById" INTEGER,
    "decidedByEmail" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "error" TEXT,

    CONSTRAINT "BackofficeApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrivacyRequest_status_dueAt_idx" ON "PrivacyRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PrivacyRequest_requesterEmail_idx" ON "PrivacyRequest"("requesterEmail");

-- CreateIndex
CREATE INDEX "BackofficeApproval_status_createdAt_idx" ON "BackofficeApproval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BackofficeApproval_requestedByEmail_idx" ON "BackofficeApproval"("requestedByEmail");

