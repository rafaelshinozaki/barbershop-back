-- Lista de espera: horário oferecido no aviso, pra passar ao próximo da fila
ALTER TABLE "WaitlistEntry" ADD COLUMN "offeredStartAt" TIMESTAMP(3),
ADD COLUMN "offeredBarberId" INTEGER,
ADD COLUMN "offeredServiceIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

CREATE INDEX "WaitlistEntry_status_notifiedAt_idx" ON "WaitlistEntry"("status", "notifiedAt");
