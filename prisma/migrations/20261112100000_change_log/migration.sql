-- Histórico de alterações (horizonte "Registros e estabilidade", R2).
-- Gravado por gatilho no banco: pega o back principal, a API do backoffice,
-- os jobs e os scripts. Quem fez vem de set_config('app.actor', <json>, true)
-- na mesma transação (o PrismaService põe); sem isso, fica como "sistema".

CREATE TABLE "ChangeLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER,
    "networkId" INTEGER,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" INTEGER,
    "actorName" TEXT,
    "actorRole" TEXT,
    "origin" TEXT NOT NULL,
    "reason" TEXT,
    "requestId" TEXT,
    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangeLog_barbershopId_createdAt_idx" ON "ChangeLog"("barbershopId", "createdAt");
CREATE INDEX "ChangeLog_networkId_createdAt_idx" ON "ChangeLog"("networkId", "createdAt");
CREATE INDEX "ChangeLog_entityType_entityId_idx" ON "ChangeLog"("entityType", "entityId");
CREATE INDEX "ChangeLog_actorId_idx" ON "ChangeLog"("actorId");
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt");

-- Telefone e e-mail: só o suficiente pra reconhecer (a•••@dominio, ••••1234)
CREATE OR REPLACE FUNCTION change_log_mask(v jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL OR v = 'null'::jsonb THEN NULL
    WHEN position('@' in (v #>> '{}')) > 1 THEN
      to_jsonb(left(v #>> '{}', 1) || '•••' || substring(v #>> '{}' from position('@' in (v #>> '{}'))))
    WHEN length(v #>> '{}') > 4 THEN to_jsonb('••••' || right(v #>> '{}', 4))
    ELSE to_jsonb('••••'::text)
  END
$$;

-- Argumentos do gatilho:
--   0 tipo da entidade (ex.: 'BarbershopService')
--   1 escopo: 'shop' (coluna barbershopId), 'shop_self' (a própria unidade),
--     'barber' (pela barberId), 'network' (coluna networkId), 'network_self'
--   2 coluna com o nome legível ('' = nenhum; no escopo barber, o nome do profissional)
--   3 campos acompanhados, separados por vírgula
--   4 campos mascarados (telefone, e-mail)
--   5 campos ocultos (só "alterado": observações, motivos, nascimento)
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
    "actorType", "actorId", "actorName", "actorRole", "origin", "reason", "requestId"
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
    left(actor ->> 'requestId', 100)
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER change_log_barbershop AFTER INSERT OR UPDATE OR DELETE ON "Barbershop"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Barbershop', 'shop_self', 'name',
  'name,slug,businessType,address,complement1,complement2,city,state,postalCode,phone,email,description,whatsapp,instagramUrl,facebookUrl,linkedinUrl,businessHours,onlineDeposit,isActive,featuredUntil,timezone,currency,photoKey,coverKey',
  '', '');

CREATE TRIGGER change_log_network AFTER INSERT OR UPDATE OR DELETE ON "Network"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Network', 'network_self', 'name',
  'name,logoKey,city,description,mission,loyaltyEnabled,loyaltyPointsPerCurrencyUnit,loyaltyPointValue,referralBonusPoints,noShowFeeEnabled,noShowFeeType,noShowFeeValue,lateCancellationWindowHours,accentColor,grayColor',
  '', '');

CREATE TRIGGER change_log_service AFTER INSERT OR UPDATE OR DELETE ON "BarbershopService"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('BarbershopService', 'shop', 'name',
  'name,description,durationMinutes,price,category,depositAmount,isActive',
  '', '');

CREATE TRIGGER change_log_product AFTER INSERT OR UPDATE OR DELETE ON "BarbershopProduct"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('BarbershopProduct', 'shop', 'name',
  'name,sku,description,salePrice,costPrice,unit,isActive,categoryId',
  '', '');

CREATE TRIGGER change_log_barber AFTER INSERT OR UPDATE OR DELETE ON "Barber"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Barber', 'shop', 'name',
  'name,staffType,takesAppointments,isActive,specialization,phone,email,hireDate,accessStartsAt,accessEndsAt,userId',
  'phone,email', '');

CREATE TRIGGER change_log_barber_schedule AFTER INSERT OR UPDATE OR DELETE ON "BarberSchedule"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('BarberSchedule', 'barber', '',
  'dayOfWeek,startTime,endTime,breakStart,breakEnd,isActive',
  '', '');

CREATE TRIGGER change_log_barber_time_off AFTER INSERT OR UPDATE OR DELETE ON "BarberTimeOff"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('BarberTimeOff', 'barber', '',
  'startAt,endAt,reason',
  '', 'reason');

CREATE TRIGGER change_log_closure AFTER INSERT OR UPDATE OR DELETE ON "BarbershopClosure"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('BarbershopClosure', 'shop', 'date',
  'date,openTime,closeTime,reason',
  '', '');

CREATE TRIGGER change_log_appointment AFTER INSERT OR UPDATE OR DELETE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Appointment', 'shop', '',
  'startAt,endAt,status,barberId,customerId,resourceId,notes,depositAmount,prepaidAmount,prepaidRefundedAmount',
  '', 'notes');

CREATE TRIGGER change_log_customer AFTER INSERT OR UPDATE OR DELETE ON "Customer"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Customer', 'network', 'name',
  'name,phone,email,birthDate,notes,isActive,marketingOptOut,blockedAt,blockedReason',
  'phone,email', 'birthDate,notes,blockedReason');

CREATE TRIGGER change_log_review AFTER INSERT OR UPDATE OR DELETE ON "Review"
  FOR EACH ROW EXECUTE FUNCTION change_log_capture('Review', 'shop', '',
  'reply,hiddenAt,reportedAt,reportReason',
  '', 'reportReason');
