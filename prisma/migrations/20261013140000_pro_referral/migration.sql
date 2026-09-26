-- Plano Pro provisório da agenda solo e indicação entre profissionais.
ALTER TABLE "User" ADD COLUMN "proUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "proReferralCode" TEXT;
CREATE UNIQUE INDEX "User_proReferralCode_key" ON "User"("proReferralCode");

CREATE TABLE "ProReferral" (
  "id" SERIAL NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "inviterUserId" INTEGER NOT NULL,
  "invitedUserId" INTEGER NOT NULL,
  "months" INTEGER NOT NULL,
  CONSTRAINT "ProReferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProReferral_invitedUserId_key" ON "ProReferral"("invitedUserId");
CREATE INDEX "ProReferral_inviterUserId_idx" ON "ProReferral"("inviterUserId");

ALTER TABLE "ProReferral" ADD CONSTRAINT "ProReferral_inviterUserId_fkey"
  FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProReferral" ADD CONSTRAINT "ProReferral_invitedUserId_fkey"
  FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
