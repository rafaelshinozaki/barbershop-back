-- Campanha para a rede inteira (o dono): conta nos limites de todas as
-- unidades da rede (item 342).
ALTER TABLE "MarketingCampaign" ADD COLUMN "networkWide" BOOLEAN NOT NULL DEFAULT false;

-- As que já existem: disparadas pelo dono da rede ou da unidade eram para a
-- rede inteira (a regra do segmento é a mesma).
UPDATE "MarketingCampaign" c
SET "networkWide" = true
FROM "Barbershop" b
JOIN "Network" n ON n.id = b."networkId"
WHERE b.id = c."barbershopId"
  AND (c."createdByUserId" = n."ownerUserId" OR c."createdByUserId" = b."ownerUserId");
