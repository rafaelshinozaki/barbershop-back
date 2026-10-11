-- Ficha apagada pela unidade vira anônima em vez de sumir com o histórico
ALTER TABLE "Customer" ADD COLUMN "deletedAt" TIMESTAMP(3);
