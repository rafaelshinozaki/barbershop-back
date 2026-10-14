-- Resto do ciclo do clube devolvido ao cliente (encerrar a unidade, estorno no Stripe)
ALTER TABLE "ClientSubscriptionPayment" ADD COLUMN "refundedAmount" DECIMAL(65,30);
