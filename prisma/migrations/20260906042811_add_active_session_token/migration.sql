-- ActiveSession rows are ephemeral (recreated on every login); existing rows
-- predate the sessionToken-based identity model, so clear them instead of
-- backfilling a fake token.
DELETE FROM "ActiveSession";

ALTER TABLE "ActiveSession" ADD COLUMN "sessionToken" TEXT NOT NULL;

CREATE UNIQUE INDEX "ActiveSession_sessionToken_key" ON "ActiveSession"("sessionToken");
