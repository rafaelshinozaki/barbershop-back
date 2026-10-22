-- Quando a conta aceitou os termos e a política de privacidade (item 257)
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);

-- Assinaturas gravadas pela importação da planilha como 'active' (minúsculo),
-- que o resto do sistema não enxerga (item 256):
-- 1) a do plano gratuito vira ACTIVE (se a conta não tem outra ativa)
UPDATE "Subscription" s
   SET status = 'ACTIVE', "updatedAt" = NOW()
  FROM "Plan" p
 WHERE s."planId" = p.id
   AND s.status = 'active'
   AND p.price = 0
   AND NOT EXISTS (
     SELECT 1 FROM "Subscription" o WHERE o."userId" = s."userId" AND o.status = 'ACTIVE'
   );

-- 2) a de plano pago (sem cobrança nenhuma) sai, e a conta fica no gratuito
WITH paid AS (
  UPDATE "Subscription"
     SET status = 'INACTIVE', "cancelationDate" = NOW(), "updatedAt" = NOW()
   WHERE status = 'active'
  RETURNING "userId"
)
INSERT INTO "Subscription" ("userId", "planId", "startSubDate", status, "createdAt", "updatedAt")
SELECT DISTINCT paid."userId", f.id, NOW(), 'ACTIVE', NOW(), NOW()
  FROM paid
  JOIN LATERAL (SELECT id FROM "Plan" WHERE name = 'Free' ORDER BY id LIMIT 1) f ON true
 WHERE NOT EXISTS (
   SELECT 1 FROM "Subscription" o WHERE o."userId" = paid."userId" AND o.status = 'ACTIVE'
 );
