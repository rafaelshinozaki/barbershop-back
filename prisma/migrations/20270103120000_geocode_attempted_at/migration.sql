-- Tentativa de geocoding que não achou o endereço. O lote seguinte pula estas
-- unidades por alguns dias, senão as mesmas 200 ocupam a fila para sempre.
ALTER TABLE "Barbershop" ADD COLUMN IF NOT EXISTS "geocodeAttemptedAt" TIMESTAMP(3);
