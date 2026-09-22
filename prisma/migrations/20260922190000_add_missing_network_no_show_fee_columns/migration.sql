-- A migration 20260913232000_add_no_show_fee_manual criou a tabela NoShowFee mas
-- não as colunas de política em Network. IF NOT EXISTS mantém idempotente para
-- bancos onde as colunas já entraram via `prisma db push`.
ALTER TABLE "Network" ADD COLUMN IF NOT EXISTS "lateCancellationWindowHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN IF NOT EXISTS "noShowFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "noShowFeeType" TEXT,
ADD COLUMN IF NOT EXISTS "noShowFeeValue" DOUBLE PRECISION;
