-- Capas e fotos de profissional que a moderação ocultou. Confirmar a
-- mesma chave de novo não devolve a imagem à página.
ALTER TABLE "Barbershop" ADD COLUMN "hiddenCoverKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Barber" ADD COLUMN "hiddenAvatarKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Barbershop"
SET "hiddenCoverKeys" = ARRAY["coverKey"]
WHERE "coverHiddenAt" IS NOT NULL AND "coverKey" IS NOT NULL AND cardinality("hiddenCoverKeys") = 0;

UPDATE "Barber"
SET "hiddenAvatarKeys" = ARRAY["avatarKey"]
WHERE "avatarHiddenAt" IS NOT NULL AND "avatarKey" IS NOT NULL AND cardinality("hiddenAvatarKeys") = 0;
