-- Campanhas passam a ser enviadas por fila: quantos entraram na fila e
-- quantos falharam de vez (os enviados já existiam)
ALTER TABLE "MarketingCampaign" ADD COLUMN IF NOT EXISTS "emailQueuedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "whatsappQueuedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "emailFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "whatsappFailedCount" INTEGER NOT NULL DEFAULT 0;

-- Consultas do sininho filtram por usuário; sem índice viram varredura da
-- tabela inteira conforme ela cresce
CREATE INDEX IF NOT EXISTS "UserNotification_userId_createdAt_idx" ON "UserNotification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserNotification_userId_isRead_idx" ON "UserNotification"("userId", "isRead");
CREATE INDEX IF NOT EXISTS "UserNotification_userId_isNew_idx" ON "UserNotification"("userId", "isNew");
