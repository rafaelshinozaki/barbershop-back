-- Cancelar vale até o fim do período pago; plano menor entra na renovação
ALTER TABLE "Subscription" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Subscription" ADD COLUMN "pendingPlanId" INTEGER;
