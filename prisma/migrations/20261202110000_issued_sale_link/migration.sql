-- A venda que emitiu o pacote ou o cartão-presente. Sem este vínculo,
-- apagar a venda deixava as sessões e o saldo valendo.
ALTER TABLE "ClientPackage" ADD COLUMN "saleId" INTEGER;

ALTER TABLE "GiftCard" ADD COLUMN "saleId" INTEGER;

CREATE UNIQUE INDEX "ClientPackage_saleId_key" ON "ClientPackage"("saleId");

CREATE UNIQUE INDEX "GiftCard_saleId_key" ON "GiftCard"("saleId");

ALTER TABLE "ClientPackage" ADD CONSTRAINT "ClientPackage_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
