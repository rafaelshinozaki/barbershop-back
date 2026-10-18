-- As FKs para BarbershopService ficaram NO ACTION (o histórico do serviço
-- apagado fica). Só que apagar a unidade ou a rede inteira (exclusão de
-- conta) tira o serviço e, em cascata, o agendamento e o item dele: com a
-- conferência imediata o Postgres acusa a FK antes da cascata do item
-- terminar. Deferida, a conferência é no fim da transação, quando os dois
-- já saíram; apagar só o serviço com histórico continua barrado.
ALTER TABLE "AppointmentService" ALTER CONSTRAINT "AppointmentService_serviceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "WalkInService" ALTER CONSTRAINT "WalkInService_serviceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ServiceHistory" ALTER CONSTRAINT "ServiceHistory_serviceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ServicePackage" ALTER CONSTRAINT "ServicePackage_serviceId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ClientSubscriptionPlan" ALTER CONSTRAINT "ClientSubscriptionPlan_serviceId_fkey" DEFERRABLE INITIALLY DEFERRED;
