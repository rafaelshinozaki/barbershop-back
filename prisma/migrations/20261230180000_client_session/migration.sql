-- Sessão do cliente final (item 272): prazo próprio com renovação e "Sair"
-- que encerra só aquela sessão.
CREATE TABLE "ClientSession" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAccountId" INTEGER NOT NULL,
    "sid" TEXT NOT NULL,

    CONSTRAINT "ClientSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientSession_sid_key" ON "ClientSession"("sid");
CREATE INDEX "ClientSession_clientAccountId_idx" ON "ClientSession"("clientAccountId");
CREATE INDEX "ClientSession_lastUsedAt_idx" ON "ClientSession"("lastUsedAt");
