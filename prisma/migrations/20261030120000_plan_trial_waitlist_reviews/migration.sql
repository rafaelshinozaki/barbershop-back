-- Cidades do profissional sem acento nem caixa, pra busca "sao paulo".
ALTER TABLE "Professional" ADD COLUMN "citySlugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Professional" p
SET "citySlugs" = COALESCE((
  SELECT array_agg(slug)
  FROM (
    SELECT DISTINCT trim(both '-' FROM regexp_replace(
      lower(translate(
        c,
        'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
      )),
      '[^a-z0-9]+', '-', 'g'
    )) AS slug
    FROM unnest(p.cities) AS c
  ) s
  WHERE slug <> ''
), ARRAY[]::TEXT[]);

-- Lista de espera pública guarda todos os serviços escolhidos.
ALTER TABLE "WaitlistEntry" ADD COLUMN "serviceIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "WaitlistEntry"
SET "serviceIds" = ARRAY["serviceId"]
WHERE "serviceId" IS NOT NULL AND cardinality("serviceIds") = 0;

-- A moderação oculta só a resposta do profissional.
ALTER TABLE "ProfessionalReview" ADD COLUMN "replyHiddenAt" TIMESTAMP(3);
