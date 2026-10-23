-- Motivo extra da pausa do clube: suspensão da unidade ou da rede, ou dono
-- desativado. A pausa do dono continua em shopPausedAt (item 262).
ALTER TABLE "ClientSubscription" ADD COLUMN "billingPauseReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
