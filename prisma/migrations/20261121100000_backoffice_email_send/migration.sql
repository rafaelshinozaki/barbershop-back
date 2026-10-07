-- CreateTable
CREATE TABLE "BackofficeEmailSend" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedByEmail" TEXT NOT NULL,
    "recipients" INTEGER NOT NULL,

    CONSTRAINT "BackofficeEmailSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackofficeEmailSend_requestedByEmail_createdAt_idx" ON "BackofficeEmailSend"("requestedByEmail", "createdAt");
