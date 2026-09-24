-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "renewalKey" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "renewalFailedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_renewalKey_key" ON "Payment"("renewalKey");


-- Dados existentes ----------------------------------------------------------
-- Plano cobrado por nós (sem assinatura no Stripe): pago até o próximo
-- vencimento do último pagamento feito
UPDATE "Subscription" s
SET "currentPeriodEnd" = p.next
FROM (
  SELECT "subscriptionId", MAX("nextPaymentDate") AS next
  FROM "Payment"
  WHERE status = 'COMPLETED'
  GROUP BY "subscriptionId"
) p
WHERE p."subscriptionId" = s.id
  AND s."stripeSubscriptionId" IS NULL
  AND s.status = 'ACTIVE';

-- Diferenças de troca de plano pendentes: o job as cobrava todo dia (a
-- pendência nunca era baixada). A troca agora vale no próximo vencimento,
-- pelo preço do plano novo — essas pendências são canceladas.
UPDATE "Payment" SET status = 'CANCELED' WHERE status = 'PENDING';
