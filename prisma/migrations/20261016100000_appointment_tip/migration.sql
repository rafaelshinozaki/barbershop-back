-- Caixinha do atendimento, registrada na mão (destino: profissional ou unidade)
CREATE TABLE "AppointmentTip" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appointmentId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "barberId" INTEGER,
    "destination" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "receivedByUnit" BOOLEAN NOT NULL DEFAULT false,
    "payEntryId" INTEGER,
    "createdByUserId" INTEGER NOT NULL,

    CONSTRAINT "AppointmentTip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentTip_payEntryId_key" ON "AppointmentTip"("payEntryId");
CREATE INDEX "AppointmentTip_appointmentId_idx" ON "AppointmentTip"("appointmentId");
CREATE INDEX "AppointmentTip_barbershopId_createdAt_idx" ON "AppointmentTip"("barbershopId", "createdAt");
CREATE INDEX "AppointmentTip_barberId_idx" ON "AppointmentTip"("barberId");

ALTER TABLE "AppointmentTip" ADD CONSTRAINT "AppointmentTip_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentTip" ADD CONSTRAINT "AppointmentTip_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentTip" ADD CONSTRAINT "AppointmentTip_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
