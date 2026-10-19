-- A mesma chave em duas linhas da galeria: fica a mais antiga, oculta se
-- qualquer uma estava oculta; as denúncias passam para ela
WITH ranked AS (
  SELECT id, "barbershopId", key,
         MIN(id) OVER (PARTITION BY "barbershopId", key) AS keep_id,
         MAX("hiddenAt") OVER (PARTITION BY "barbershopId", key) AS hidden_at
  FROM "BarbershopPhoto"
)
UPDATE "BarbershopPhoto" p
SET "hiddenAt" = r.hidden_at
FROM ranked r
WHERE p.id = r.keep_id AND r.id = r.keep_id AND r.hidden_at IS NOT NULL;

WITH ranked AS (
  SELECT id, MIN(id) OVER (PARTITION BY "barbershopId", key) AS keep_id
  FROM "BarbershopPhoto"
)
UPDATE "ContentReport" c
SET "targetId" = r.keep_id
FROM ranked r
WHERE c."targetType" = 'photo' AND c."targetId" = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id, MIN(id) OVER (PARTITION BY "barbershopId", key) AS keep_id
  FROM "BarbershopPhoto"
)
DELETE FROM "BarbershopPhoto" p
USING ranked r
WHERE p.id = r.id AND r.id <> r.keep_id;

-- CreateIndex
CREATE UNIQUE INDEX "BarbershopPhoto_barbershopId_key_key" ON "BarbershopPhoto"("barbershopId", "key");
