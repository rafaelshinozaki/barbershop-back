-- Validade opcional do pacote e o registro de cada sessão usada
-- (quem baixou, em qual atendimento e em qual venda).
ALTER TABLE "ServicePackage" ADD COLUMN "validityDays" INTEGER;

ALTER TABLE "ClientPackage" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE TABLE "ClientPackageUse" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientPackageId" INTEGER NOT NULL,
    "appointmentId" INTEGER,
    "saleId" INTEGER,
    "usedByUserId" INTEGER NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneByUserId" INTEGER,

    CONSTRAINT "ClientPackageUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientPackageUse_clientPackageId_idx" ON "ClientPackageUse"("clientPackageId");

CREATE INDEX "ClientPackageUse_saleId_idx" ON "ClientPackageUse"("saleId");

ALTER TABLE "ClientPackageUse" ADD CONSTRAINT "ClientPackageUse_clientPackageId_fkey" FOREIGN KEY ("clientPackageId") REFERENCES "ClientPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
