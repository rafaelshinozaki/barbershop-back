-- Quem pediu para sair na área do cliente. Nulo: saiu respondendo SAIR
-- no WhatsApp, e a conta não desfaz (item 292).
ALTER TABLE "WhatsappOptOut" ADD COLUMN "clientAccountId" INTEGER;

ALTER TABLE "WhatsappOptOut"
  ADD CONSTRAINT "WhatsappOptOut_clientAccountId_fkey"
  FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WhatsappOptOut_clientAccountId_idx" ON "WhatsappOptOut" ("clientAccountId");
