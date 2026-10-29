-- Aceite dos termos (versão), assinatura da ficha e uma volta à vaga (itens 406–409, 420)
ALTER TABLE "User" ADD COLUMN "termsVersion" TEXT;

ALTER TABLE "ClientAccount" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "termsVersion" TEXT;

ALTER TABLE "ConsentForm" ADD COLUMN "signedVia" TEXT,
ADD COLUMN "signatureIp" TEXT,
ADD COLUMN "textVersion" TEXT,
ADD COLUMN "recordedByName" TEXT,
ADD COLUMN "signToken" TEXT;

CREATE UNIQUE INDEX "ConsentForm_signToken_key" ON "ConsentForm"("signToken");

ALTER TABLE "JobApplication" ADD COLUMN "returnedOnce" BOOLEAN NOT NULL DEFAULT false;
