-- Preço contratado da assinatura do clube (item 360): mudar o preço do plano
-- vale só para quem assinar depois, como o Price da Stripe.
ALTER TABLE "ClientSubscription" ADD COLUMN "price" DECIMAL(65,30);

-- As que já existem: o último pagamento que entrou (o valor cobrado pela
-- Stripe); sem pagamento ainda, o preço atual do plano.
UPDATE "ClientSubscription" s
SET "price" = COALESCE(
  (SELECT p.amount FROM "ClientSubscriptionPayment" p
    WHERE p."subscriptionId" = s.id AND p.status = 'SUCCEEDED'
    ORDER BY p."createdAt" DESC LIMIT 1),
  (SELECT pl.price FROM "ClientSubscriptionPlan" pl WHERE pl.id = s."planId")
);
