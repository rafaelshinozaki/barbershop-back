-- Histórico: o profissional (cargos barbeiro e básico) vê só o que é da
-- própria agenda. Cada linha guarda de quais profissionais ela é: o cadastro
-- dele, a escala, as folgas e os agendamentos (de antes e de depois, quando
-- o agendamento passa de um para outro).

ALTER TABLE "ChangeLog" ADD COLUMN "barberIds" INTEGER[] NOT NULL DEFAULT '{}';
CREATE INDEX "ChangeLog_barberIds_idx" ON "ChangeLog" USING GIN ("barberIds");

CREATE OR REPLACE FUNCTION change_log_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entity_type text := TG_ARGV[0];
  scope text := TG_ARGV[1];
  name_col text := TG_ARGV[2];
  fields text[] := string_to_array(TG_ARGV[3], ',');
  masked text[] := coalesce(string_to_array(nullif(TG_ARGV[4], ''), ','), '{}');
  hidden text[] := coalesce(string_to_array(nullif(TG_ARGV[5], ''), ','), '{}');
  old_row jsonb;
  new_row jsonb;
  cur jsonb;
  diff jsonb := '{}'::jsonb;
  f text;
  before_v jsonb;
  after_v jsonb;
  actor jsonb;
  shop_id integer;
  net_id integer;
  label text;
  raw_actor text;
  barber_ids integer[];
BEGIN
  -- Exclusão do negócio inteiro (LGPD): o histórico dele sai junto, não
  -- vale gravar uma linha por agendamento apagado em cascata
  IF current_setting('app.change_log_off', true) = 'on' THEN RETURN NULL; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  cur := coalesce(new_row, old_row);

  FOREACH f IN ARRAY fields LOOP
    before_v := old_row -> f;
    after_v := new_row -> f;
    IF before_v = 'null'::jsonb THEN before_v := NULL; END IF;
    IF after_v = 'null'::jsonb THEN after_v := NULL; END IF;
    IF before_v IS DISTINCT FROM after_v THEN
      IF f = ANY(hidden) THEN
        before_v := CASE WHEN before_v IS NULL THEN NULL ELSE to_jsonb('•••'::text) END;
        after_v := CASE WHEN after_v IS NULL THEN NULL ELSE to_jsonb('•••'::text) END;
      ELSIF f = ANY(masked) THEN
        before_v := change_log_mask(before_v);
        after_v := change_log_mask(after_v);
      END IF;
      diff := diff || jsonb_build_object(f, jsonb_build_array(before_v, after_v));
    END IF;
  END LOOP;

  -- Só mudou o que não é acompanhado (updatedAt, lembrete enviado…): nada
  IF diff = '{}'::jsonb THEN RETURN NULL; END IF;

  IF name_col <> '' AND scope <> 'barber' THEN label := cur ->> name_col; END IF;

  IF scope = 'shop_self' THEN
    shop_id := (cur ->> 'id')::integer;
    net_id := (cur ->> 'networkId')::integer;
  ELSIF scope = 'shop' THEN
    shop_id := (cur ->> 'barbershopId')::integer;
    SELECT "networkId" INTO net_id FROM "Barbershop" WHERE id = shop_id;
  ELSIF scope = 'barber' THEN
    SELECT b."barbershopId", b.name, s."networkId" INTO shop_id, label, net_id
      FROM "Barber" b JOIN "Barbershop" s ON s.id = b."barbershopId"
      WHERE b.id = (cur ->> 'barberId')::integer;
  ELSIF scope = 'network' THEN
    net_id := (cur ->> 'networkId')::integer;
  ELSIF scope = 'network_self' THEN
    net_id := (cur ->> 'id')::integer;
  END IF;

  -- De quais profissionais é a linha (o profissional vê só a própria
  -- agenda): o próprio cadastro, ou a barberId de antes e de depois (o
  -- agendamento passado de um para outro aparece para os dois)
  IF entity_type = 'Barber' THEN
    barber_ids := ARRAY[(cur ->> 'id')::integer];
  ELSIF cur ? 'barberId' THEN
    barber_ids := ARRAY(
      SELECT DISTINCT x FROM unnest(ARRAY[
        (old_row ->> 'barberId')::integer, (new_row ->> 'barberId')::integer
      ]) AS x WHERE x IS NOT NULL ORDER BY x);
  ELSE
    barber_ids := '{}';
  END IF;

  raw_actor := nullif(current_setting('app.actor', true), '');
  IF raw_actor IS NOT NULL THEN
    BEGIN
      actor := raw_actor::jsonb;
    EXCEPTION WHEN others THEN
      actor := NULL;
    END;
  END IF;

  INSERT INTO "ChangeLog" (
    "barbershopId", "networkId", "entityType", "entityId", "entityName", "action", "changes",
    "actorType", "actorId", "actorName", "actorRole", "origin", "reason", "requestId", "barberIds"
  ) VALUES (
    shop_id, net_id, entity_type, cur ->> 'id', left(label, 200),
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    diff,
    coalesce(actor ->> 'type', 'system'),
    (actor ->> 'id')::integer,
    left(actor ->> 'name', 200),
    left(actor ->> 'role', 60),
    coalesce(actor ->> 'origin', 'system'),
    left(actor ->> 'reason', 500),
    left(actor ->> 'requestId', 100),
    barber_ids
  );
  RETURN NULL;
END;
$$;

-- Linhas já gravadas: pelo cadastro atual e pelo antes → depois guardado
UPDATE "ChangeLog" SET "barberIds" = ARRAY["entityId"::integer]
  WHERE "entityType" = 'Barber';

UPDATE "ChangeLog" c SET "barberIds" = ARRAY(
  SELECT DISTINCT x FROM unnest(ARRAY[
    (SELECT a."barberId" FROM "Appointment" a WHERE a.id = c."entityId"::integer),
    (c.changes -> 'barberId' ->> 0)::integer,
    (c.changes -> 'barberId' ->> 1)::integer
  ]) AS x WHERE x IS NOT NULL ORDER BY x)
  WHERE c."entityType" = 'Appointment';

UPDATE "ChangeLog" c SET "barberIds" = ARRAY[s."barberId"]
  FROM "BarberSchedule" s
  WHERE c."entityType" = 'BarberSchedule' AND s.id = c."entityId"::integer;

UPDATE "ChangeLog" c SET "barberIds" = ARRAY[t."barberId"]
  FROM "BarberTimeOff" t
  WHERE c."entityType" = 'BarberTimeOff' AND t.id = c."entityId"::integer;
