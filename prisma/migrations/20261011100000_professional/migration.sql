-- Identidade do profissional, uma por conta. Os vínculos (Barber) de cada
-- unidade passam a apontar pra ela.
CREATE TABLE "Professional" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Professional_userId_key" ON "Professional"("userId");
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Professional" ("userId", "updatedAt")
SELECT DISTINCT "userId", CURRENT_TIMESTAMP
FROM "Barber"
WHERE "userId" IS NOT NULL;

ALTER TABLE "Barber" ADD COLUMN "professionalId" INTEGER;
CREATE INDEX "Barber_professionalId_idx" ON "Barber"("professionalId");
ALTER TABLE "Barber" ADD CONSTRAINT "Barber_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Barber" AS b
SET "professionalId" = p."id"
FROM "Professional" AS p
WHERE b."userId" = p."userId";
