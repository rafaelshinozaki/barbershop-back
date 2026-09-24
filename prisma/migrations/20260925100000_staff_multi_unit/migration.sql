-- Uma pessoa pode estar na equipe de várias unidades: um vínculo por unidade
DROP INDEX "Barber_userId_key";
CREATE UNIQUE INDEX "Barber_barbershopId_userId_key" ON "Barber"("barbershopId", "userId");

-- Vínculo temporário (freelancer)
ALTER TABLE "Barber" ADD COLUMN "accessStartsAt" TIMESTAMP(3),
ADD COLUMN "accessEndsAt" TIMESTAMP(3);
