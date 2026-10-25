-- Login social (item 271): o vínculo guarda o id da pessoa no provedor e a
-- conta é achada por ele nos próximos logins, não só pelo e-mail.
ALTER TABLE "LinkedSocialAccount" ADD COLUMN "providerUserId" TEXT;
ALTER TABLE "ClientLinkedSocialAccount" ADD COLUMN "providerUserId" TEXT;

CREATE UNIQUE INDEX "LinkedSocialAccount_provider_providerUserId_key" ON "LinkedSocialAccount"("provider", "providerUserId");
CREATE UNIQUE INDEX "ClientLinkedSocialAccount_provider_providerUserId_key" ON "ClientLinkedSocialAccount"("provider", "providerUserId");
