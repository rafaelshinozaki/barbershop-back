-- CreateTable
CREATE TABLE "ChatThread" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "barberId" INTEGER,
    "lastMessageAt" TIMESTAMP(3),
    "clientReadAt" TIMESTAMP(3),
    "staffReadAt" TIMESTAMP(3),
    "clientNotifiedAt" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3),

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" INTEGER NOT NULL,
    "senderSide" TEXT NOT NULL,
    "senderUserId" INTEGER,
    "body" TEXT NOT NULL,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatThread_barbershopId_lastMessageAt_idx" ON "ChatThread"("barbershopId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatThread_barberId_lastMessageAt_idx" ON "ChatThread"("barberId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatThread_customerId_idx" ON "ChatThread"("customerId");

-- CreateIndex
CREATE INDEX "ChatThread_lastMessageAt_idx" ON "ChatThread"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatThread_appointmentId_kind_key" ON "ChatThread"("appointmentId", "kind");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
