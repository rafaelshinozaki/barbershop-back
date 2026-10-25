-- Candidatura aceita que já virou equipe (item 281): a rotina que libera os
-- aceitos sem entrar só olha as que ainda esperam o convite.
ALTER TABLE "JobApplication" ADD COLUMN "joinedAt" TIMESTAMP(3);

UPDATE "JobApplication" a SET "joinedAt" = coalesce(i."updatedAt", a."decidedAt", NOW())
  FROM "EmployeeInvite" i
  WHERE a."inviteId" = i.id AND a.status = 'accepted' AND i.status = 'ACCEPTED';

CREATE INDEX "JobApplication_status_joinedAt_idx" ON "JobApplication"("status", "joinedAt");
