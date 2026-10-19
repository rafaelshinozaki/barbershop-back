-- Venda que completou a indicação (apagar a venda tira o bônus)
ALTER TABLE "CustomerReferral" ADD COLUMN "saleId" INTEGER;
CREATE INDEX "CustomerReferral_saleId_idx" ON "CustomerReferral"("saleId");
