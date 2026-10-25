-- Aumento do aluguel da cadeira cobrado no cartão espera o aceite do
-- profissional (item 278)
ALTER TABLE "SharedLocationMember" ADD COLUMN "rentPendingAmount" DECIMAL(65,30),
ADD COLUMN "rentPendingAt" TIMESTAMP(3);
