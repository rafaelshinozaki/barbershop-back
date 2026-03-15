-- Insert BarbershopOwner and BarbershopEmployee roles into Role table
-- Uses WHERE NOT EXISTS to avoid duplicates (idempotent)

INSERT INTO "Role" (name)
SELECT 'BarbershopOwner'
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'BarbershopOwner');

INSERT INTO "Role" (name)
SELECT 'BarbershopEmployee'
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'BarbershopEmployee');
