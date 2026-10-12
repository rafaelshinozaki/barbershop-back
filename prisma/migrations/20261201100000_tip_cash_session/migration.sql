-- Caixinha em dinheiro deixada no balcão entra no caixa aberto
ALTER TABLE "AppointmentTip" ADD COLUMN "cashSessionId" INTEGER;
CREATE INDEX "AppointmentTip_cashSessionId_idx" ON "AppointmentTip"("cashSessionId");
