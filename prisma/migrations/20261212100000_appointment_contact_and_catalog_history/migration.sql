-- E-mail digitado no agendamento online. Os avisos daquele horário usam esta coluna.
ALTER TABLE "Appointment" ADD COLUMN "contactEmail" TEXT;

-- Relatórios por data de pagamento, histórico do cliente e agenda de quem atende em várias unidades.
CREATE INDEX "Sale_barbershopId_paidAt_idx" ON "Sale"("barbershopId", "paidAt");
CREATE INDEX "Appointment_customerId_startAt_idx" ON "Appointment"("customerId", "startAt");
CREATE INDEX "Appointment_barberId_startAt_idx" ON "Appointment"("barberId", "startAt");

-- Apagar serviço ou produto não leva o histórico. NoAction é conferido no fim do
-- comando, então excluir a unidade (que apaga horário e serviço juntos) continua possível.
ALTER TABLE "AppointmentService" DROP CONSTRAINT "AppointmentService_serviceId_fkey";
ALTER TABLE "AppointmentService" ADD CONSTRAINT "AppointmentService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "WalkInService" DROP CONSTRAINT "WalkInService_serviceId_fkey";
ALTER TABLE "WalkInService" ADD CONSTRAINT "WalkInService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ServiceHistory" DROP CONSTRAINT "ServiceHistory_serviceId_fkey";
ALTER TABLE "ServiceHistory" ADD CONSTRAINT "ServiceHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ServicePackage" DROP CONSTRAINT "ServicePackage_serviceId_fkey";
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "ClientSubscriptionPlan" DROP CONSTRAINT "ClientSubscriptionPlan_serviceId_fkey";
ALTER TABLE "ClientSubscriptionPlan" ADD CONSTRAINT "ClientSubscriptionPlan_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_serviceId_fkey";
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "BarbershopService"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SaleItem" DROP CONSTRAINT "SaleItem_productId_fkey";
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "BarbershopProduct"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "InventoryItem" DROP CONSTRAINT "InventoryItem_productId_fkey";
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "BarbershopProduct"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
