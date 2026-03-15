-- Step 1: Create Network table
CREATE TABLE "Network" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "ownerUserId" INTEGER NOT NULL,

    CONSTRAINT "Network_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Network_ownerUserId_idx" ON "Network"("ownerUserId");

ALTER TABLE "Network" ADD CONSTRAINT "Network_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 2: Add networkId to Barbershop as nullable
ALTER TABLE "Barbershop" ADD COLUMN "networkId" INTEGER;

-- Step 3: Create one Network per unique ownerUserId and assign to Barbershops
INSERT INTO "Network" ("createdAt", "updatedAt", "ownerUserId")
SELECT NOW(), NOW(), "ownerUserId"
FROM "Barbershop"
WHERE "ownerUserId" IS NOT NULL
GROUP BY "ownerUserId";

-- For barbershops without ownerUserId, create a placeholder network (will use first user or require manual fix)
-- Create a fallback network for barbershops with null ownerUserId if any exist
INSERT INTO "Network" ("createdAt", "updatedAt", "ownerUserId")
SELECT NOW(), NOW(), (SELECT "id" FROM "User" LIMIT 1)
FROM (SELECT 1) AS dummy
WHERE EXISTS (SELECT 1 FROM "Barbershop" WHERE "ownerUserId" IS NULL);

-- Update Barbershop.networkId from created networks
UPDATE "Barbershop" b
SET "networkId" = n."id"
FROM "Network" n
WHERE (b."ownerUserId" IS NOT NULL AND b."ownerUserId" = n."ownerUserId")
   OR (b."ownerUserId" IS NULL AND n."id" = (SELECT "id" FROM "Network" ORDER BY "id" DESC LIMIT 1));

-- Step 4: Make Barbershop.networkId required
ALTER TABLE "Barbershop" ALTER COLUMN "networkId" SET NOT NULL;

CREATE INDEX "Barbershop_networkId_idx" ON "Barbershop"("networkId");
ALTER TABLE "Barbershop" ADD CONSTRAINT "Barbershop_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 5: Add networkId to Customer (nullable first)
ALTER TABLE "Customer" ADD COLUMN "networkId" INTEGER;

-- Step 6: Populate Customer.networkId from Barbershop
UPDATE "Customer" c
SET "networkId" = b."networkId"
FROM "Barbershop" b
WHERE c."barbershopId" = b."id";

-- Step 7: Drop barbershopId from Customer
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_barbershopId_fkey";
DROP INDEX IF EXISTS "Customer_barbershopId_email_idx";
DROP INDEX IF EXISTS "Customer_barbershopId_idx";
DROP INDEX IF EXISTS "Customer_barbershopId_phone_idx";
ALTER TABLE "Customer" DROP COLUMN "barbershopId";

-- Step 8: Make Customer.networkId required
ALTER TABLE "Customer" ALTER COLUMN "networkId" SET NOT NULL;

CREATE INDEX "Customer_networkId_idx" ON "Customer"("networkId");
CREATE INDEX "Customer_networkId_phone_idx" ON "Customer"("networkId", "phone");
CREATE INDEX "Customer_networkId_email_idx" ON "Customer"("networkId", "email");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "Network"("id") ON DELETE CASCADE ON UPDATE CASCADE;
