-- O limite de sessões fica na assinatura, não só no plano.
ALTER TABLE "ClientSubscription" ADD COLUMN "sessionsPerCycle" INTEGER;

UPDATE "ClientSubscription" AS s
SET "sessionsPerCycle" = p."sessionsPerCycle"
FROM "ClientSubscriptionPlan" AS p
WHERE p.id = s."planId";
