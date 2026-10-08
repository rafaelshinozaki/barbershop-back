-- E-mail da equipe deixa de diferenciar maiúsculas.
-- Duplicata (mesmo lower(email) e provider): fica a conta ativa mais antiga.
-- A outra fica inativa e o e-mail ganha +dup<id>, porque juntar agenda,
-- venda e assinatura de duas contas misturaria pessoas diferentes.
-- Quem entra com o endereço cai na conta que ficou.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY provider, lower(btrim(email))
      ORDER BY "isActive" DESC, "createdAt" ASC, id ASC
    ) AS rn
  FROM "User"
)
UPDATE "User" u
SET
  email = CASE
    WHEN position('@' IN btrim(u.email)) > 0
      THEN regexp_replace(lower(btrim(u.email)), '@', '+dup' || u.id || '@')
    ELSE lower(btrim(u.email)) || '+dup' || u.id
  END,
  "isActive" = false
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;

UPDATE "User"
SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY provider, lower(btrim("providerEmail"))
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "LinkedSocialAccount"
)
UPDATE "LinkedSocialAccount" a
SET "providerEmail" = CASE
  WHEN position('@' IN btrim(a."providerEmail")) > 0
    THEN regexp_replace(lower(btrim(a."providerEmail")), '@', '+dup' || a.id || '@')
  ELSE lower(btrim(a."providerEmail")) || '+dup' || a.id
END
FROM ranked r
WHERE a.id = r.id
  AND r.rn > 1;

UPDATE "LinkedSocialAccount"
SET "providerEmail" = lower(btrim("providerEmail"))
WHERE "providerEmail" IS DISTINCT FROM lower(btrim("providerEmail"));

CREATE UNIQUE INDEX "User_email_provider_lower_key"
  ON "User" (lower(email), provider);

CREATE UNIQUE INDEX "LinkedSocialAccount_provider_providerEmail_lower_key"
  ON "LinkedSocialAccount" (provider, lower("providerEmail"));
