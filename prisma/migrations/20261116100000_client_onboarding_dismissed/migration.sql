-- "Dispensar" das boas-vindas da área do cliente
ALTER TABLE "ClientAccount" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);
