-- Código de indicação aleatório (antes era o id do cliente)
ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT;

CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");
