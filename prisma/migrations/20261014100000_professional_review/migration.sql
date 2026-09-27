-- Avaliação do profissional por atendimento concluído
CREATE TABLE "ProfessionalReview" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "barberId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "professionalId" INTEGER,
    "customerId" INTEGER,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),

    CONSTRAINT "ProfessionalReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfessionalReview_appointmentId_key" ON "ProfessionalReview"("appointmentId");
CREATE INDEX "ProfessionalReview_professionalId_createdAt_idx" ON "ProfessionalReview"("professionalId", "createdAt");
CREATE INDEX "ProfessionalReview_barberId_idx" ON "ProfessionalReview"("barberId");

ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProfessionalReview" ADD CONSTRAINT "ProfessionalReview_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
