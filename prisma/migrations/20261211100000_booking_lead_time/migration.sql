-- Antecedência mínima do agendamento online. 0 = o horário só precisa não ter começado.
ALTER TABLE "Barbershop" ADD COLUMN "minBookingLeadMinutes" INTEGER NOT NULL DEFAULT 0;
