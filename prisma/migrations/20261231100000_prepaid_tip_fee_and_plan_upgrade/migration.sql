-- Taxa gravada na cobrança do pagamento antecipado e da caixinha (item 302)
-- e a cobrança da diferença de plano (item 305).

ALTER TABLE "Appointment" ADD COLUMN "prepaidPlatformFeePercent" DECIMAL(65,30);

ALTER TABLE "AppointmentTip" ADD COLUMN "platformFeePercent" DECIMAL(65,30);

ALTER TABLE "Payment" ADD COLUMN "kind" TEXT;
ALTER TABLE "Payment" ADD COLUMN "previousPlanId" INTEGER;
