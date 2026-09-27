-- Nota do cliente (pontualidade e trato) dada pela unidade e pelo profissional
ALTER TABLE "Appointment" ADD COLUMN "clientRatingRequestSentAt" TIMESTAMP(3);

CREATE TABLE "CustomerRating" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "raterUserId" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "treatment" INTEGER NOT NULL,

    CONSTRAINT "CustomerRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerRating_appointmentId_side_key" ON "CustomerRating"("appointmentId", "side");
CREATE INDEX "CustomerRating_customerId_idx" ON "CustomerRating"("customerId");

ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRating" ADD CONSTRAINT "CustomerRating_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
