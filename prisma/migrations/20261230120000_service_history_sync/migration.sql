-- Histórico de atendimentos (item 273). Nenhum fluxo do app gravava
-- ServiceHistory: a ficha ficava vazia, o painel mostrava zero e o público
-- "inativos" das campanhas não achava ninguém. Os gatilhos abaixo mantêm o
-- histórico igual aos horários concluídos e à fila atendida, venha a
-- conclusão de onde vier (edição do horário, fechar a conta, importação,
-- fila). Voltar da situação "concluído" tira a linha.

CREATE OR REPLACE FUNCTION service_history_sync_appointment(appt_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  a record;
BEGIN
  SELECT id, "barbershopId", "customerId", "barberId", "startAt", status INTO a
    FROM "Appointment" WHERE id = appt_id;
  IF NOT FOUND OR a.status <> 'COMPLETED' THEN
    DELETE FROM "ServiceHistory" WHERE "appointmentId" = appt_id;
    RETURN;
  END IF;

  DELETE FROM "ServiceHistory" h
    WHERE h."appointmentId" = appt_id
      AND NOT EXISTS (
        SELECT 1 FROM "AppointmentService" s
        WHERE s."appointmentId" = appt_id AND s."serviceId" = h."serviceId");

  UPDATE "ServiceHistory" h SET
      "barbershopId" = a."barbershopId",
      "customerId" = a."customerId",
      "barberId" = a."barberId",
      "performedAt" = a."startAt",
      "priceCharged" = (
        SELECT coalesce(sum(s."unitPrice" * s.quantity), 0) FROM "AppointmentService" s
        WHERE s."appointmentId" = appt_id AND s."serviceId" = h."serviceId")
    WHERE h."appointmentId" = appt_id;

  INSERT INTO "ServiceHistory" (
    "barbershopId", "customerId", "barberId", "appointmentId", "serviceId",
    "performedAt", "priceCharged", "durationMinutes")
  SELECT a."barbershopId", a."customerId", a."barberId", appt_id, s."serviceId",
         a."startAt", sum(s."unitPrice" * s.quantity), max(bs."durationMinutes")
    FROM "AppointmentService" s
    JOIN "BarbershopService" bs ON bs.id = s."serviceId"
    WHERE s."appointmentId" = appt_id
      AND NOT EXISTS (
        SELECT 1 FROM "ServiceHistory" h
        WHERE h."appointmentId" = appt_id AND h."serviceId" = s."serviceId")
    GROUP BY s."serviceId";
END;
$$;

CREATE OR REPLACE FUNCTION service_history_sync_walk_in(walk_in_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  w record;
BEGIN
  SELECT id, "barbershopId", "customerId", "barberId", "servedAt", "createdAt", status INTO w
    FROM "WalkIn" WHERE id = walk_in_id;
  IF NOT FOUND OR w.status <> 'COMPLETED' OR w."customerId" IS NULL OR w."barberId" IS NULL THEN
    DELETE FROM "ServiceHistory" WHERE "walkInId" = walk_in_id;
    RETURN;
  END IF;

  DELETE FROM "ServiceHistory" h
    WHERE h."walkInId" = walk_in_id
      AND NOT EXISTS (
        SELECT 1 FROM "WalkInService" s
        WHERE s."walkInId" = walk_in_id AND s."serviceId" = h."serviceId");

  UPDATE "ServiceHistory" h SET
      "barbershopId" = w."barbershopId",
      "customerId" = w."customerId",
      "barberId" = w."barberId",
      "performedAt" = coalesce(w."servedAt", w."createdAt")
    WHERE h."walkInId" = walk_in_id;

  INSERT INTO "ServiceHistory" (
    "barbershopId", "customerId", "barberId", "walkInId", "serviceId",
    "performedAt", "priceCharged", "durationMinutes")
  SELECT w."barbershopId", w."customerId", w."barberId", walk_in_id, s."serviceId",
         coalesce(w."servedAt", w."createdAt"), sum(bs.price * s.quantity),
         max(bs."durationMinutes")
    FROM "WalkInService" s
    JOIN "BarbershopService" bs ON bs.id = s."serviceId"
    WHERE s."walkInId" = walk_in_id
      AND NOT EXISTS (
        SELECT 1 FROM "ServiceHistory" h
        WHERE h."walkInId" = walk_in_id AND h."serviceId" = s."serviceId")
    GROUP BY s."serviceId";
END;
$$;

CREATE OR REPLACE FUNCTION service_history_appointment_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Antes de a chave virar nula (ON DELETE SET NULL): horário apagado sai
    DELETE FROM "ServiceHistory" WHERE "appointmentId" = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM service_history_sync_appointment(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION service_history_appointment_service_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM service_history_sync_appointment(coalesce(NEW."appointmentId", OLD."appointmentId"));
  IF TG_OP = 'UPDATE' AND NEW."appointmentId" <> OLD."appointmentId" THEN
    PERFORM service_history_sync_appointment(OLD."appointmentId");
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION service_history_walk_in_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "ServiceHistory" WHERE "walkInId" = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM service_history_sync_walk_in(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION service_history_walk_in_service_trg() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM service_history_sync_walk_in(coalesce(NEW."walkInId", OLD."walkInId"));
  RETURN NULL;
END;
$$;

CREATE TRIGGER service_history_appointment
  AFTER INSERT OR UPDATE OF status, "customerId", "barberId", "startAt", "barbershopId"
  ON "Appointment" FOR EACH ROW EXECUTE FUNCTION service_history_appointment_trg();
CREATE TRIGGER service_history_appointment_delete
  BEFORE DELETE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION service_history_appointment_trg();
CREATE TRIGGER service_history_appointment_service
  AFTER INSERT OR UPDATE OR DELETE ON "AppointmentService"
  FOR EACH ROW EXECUTE FUNCTION service_history_appointment_service_trg();
CREATE TRIGGER service_history_walk_in
  AFTER INSERT OR UPDATE OF status, "customerId", "barberId", "servedAt", "barbershopId"
  ON "WalkIn" FOR EACH ROW EXECUTE FUNCTION service_history_walk_in_trg();
CREATE TRIGGER service_history_walk_in_delete
  BEFORE DELETE ON "WalkIn" FOR EACH ROW EXECUTE FUNCTION service_history_walk_in_trg();
CREATE TRIGGER service_history_walk_in_service
  AFTER INSERT OR UPDATE OR DELETE ON "WalkInService"
  FOR EACH ROW EXECUTE FUNCTION service_history_walk_in_service_trg();

-- O passado: tudo o que já foi concluído entra no histórico
SELECT service_history_sync_appointment(id) FROM "Appointment" WHERE status = 'COMPLETED';
SELECT service_history_sync_walk_in(id) FROM "WalkIn" WHERE status = 'COMPLETED';
