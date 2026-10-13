-- Taxa de falta recebida: a venda lançada no caixa
ALTER TABLE "NoShowFee" ADD COLUMN "saleId" INTEGER;

CREATE UNIQUE INDEX "NoShowFee_saleId_key" ON "NoShowFee"("saleId");
