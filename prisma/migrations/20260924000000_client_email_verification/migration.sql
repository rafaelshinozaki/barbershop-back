-- DropForeignKey
ALTER TABLE "EmailLogger" DROP CONSTRAINT "EmailLogger_userId_fkey";

-- AlterTable
ALTER TABLE "ClientAccount" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "language" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EmailLogger" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ClientAccountToken" (
    "id" SERIAL NOT NULL,
    "clientAccountId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccountToken_tokenHash_key" ON "ClientAccountToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientAccountToken_clientAccountId_purpose_idx" ON "ClientAccountToken"("clientAccountId", "purpose");

-- AddForeignKey
ALTER TABLE "EmailLogger" ADD CONSTRAINT "EmailLogger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAccountToken" ADD CONSTRAINT "ClientAccountToken_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Dados existentes ----------------------------------------------------------
-- Conta com login social do mesmo e-mail: o provedor (Google/Facebook/Apple)
-- já confirmou o e-mail
UPDATE "ClientAccount" ca
SET "emailVerifiedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "ClientLinkedSocialAccount" s
  WHERE s."clientAccountId" = ca.id AND lower(s."providerEmail") = lower(ca.email)
);

-- Fichas ligadas a conta sem e-mail confirmado podiam ser de outra pessoa
-- (bastava cadastrar o e-mail ou o telefone dela). Desliga; quando o dono
-- da conta confirmar o e-mail, as fichas com esse e-mail voltam.
UPDATE "Customer" c
SET "clientAccountId" = NULL
FROM "ClientAccount" ca
WHERE c."clientAccountId" = ca.id AND ca."emailVerifiedAt" IS NULL;
