-- Aluguel da cadeira estornado pelo painel da Stripe (item 180)
ALTER TABLE "ChairRentPayment" ADD COLUMN "refundedAmount" DECIMAL(65,30);

-- Clube com a cobrança suspensa enquanto a unidade está pausada (item 181)
ALTER TABLE "ClientSubscription" ADD COLUMN "shopPausedAt" TIMESTAMP(3);
