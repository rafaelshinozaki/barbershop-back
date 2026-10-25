-- Ficha de saúde (item 276): quem criou o horário (o do próprio profissional
-- não abre a ficha) e o registro de quem abriu as respostas.
ALTER TABLE "Appointment" ADD COLUMN "createdByUserId" INTEGER;

CREATE TABLE "HealthFormAccess" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "HealthFormAccess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HealthFormAccess_barbershopId_customerId_createdAt_idx" ON "HealthFormAccess"("barbershopId", "customerId", "createdAt");
CREATE INDEX "HealthFormAccess_createdAt_idx" ON "HealthFormAccess"("createdAt");
