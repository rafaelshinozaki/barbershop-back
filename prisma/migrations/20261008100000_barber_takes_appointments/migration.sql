-- Quem atende clientes (entra na agenda e ocupa vaga do plano); vazio segue o
-- cargo (recepção não atende, os demais atendem)
ALTER TABLE "Barber" ADD COLUMN "takesAppointments" BOOLEAN;
