-- Regra padrão da unidade (barberId vazio) repetida: fica a mais recente.
-- O índice único (barbershopId, barberId, itemType) não pegava o vazio
DELETE FROM "CommissionRule" r
USING "CommissionRule" newer
WHERE r."barberId" IS NULL
  AND newer."barberId" IS NULL
  AND newer."barbershopId" = r."barbershopId"
  AND newer."itemType" = r."itemType"
  AND (newer."updatedAt" > r."updatedAt" OR (newer."updatedAt" = r."updatedAt" AND newer.id > r.id));

CREATE UNIQUE INDEX "CommissionRule_shop_default_key"
  ON "CommissionRule"("barbershopId", "itemType") WHERE "barberId" IS NULL;
