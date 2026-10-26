-- Inscrição de aviso guarda a sessão que a criou (item 316)
ALTER TABLE "PushSubscription" ADD COLUMN "sessionToken" TEXT;

CREATE INDEX "PushSubscription_sessionToken_idx" ON "PushSubscription"("sessionToken");
