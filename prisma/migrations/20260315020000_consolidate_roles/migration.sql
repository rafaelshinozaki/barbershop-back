-- Consolidate roles: merge SystemAdmin -> Admin, SystemManager -> Manager
-- Remove deprecated roles: SystemAdmin, SystemManager, UserPlanBasic, UserPlanMedium, UserPlanPremium, Member

-- 1. Migrate users from SystemAdmin to Admin
UPDATE "User"
SET "roleId" = (SELECT id FROM "Role" WHERE name = 'Admin' LIMIT 1)
WHERE "roleId" IN (SELECT id FROM "Role" WHERE name = 'SystemAdmin');

-- 2. Migrate users from SystemManager to Manager
UPDATE "User"
SET "roleId" = (SELECT id FROM "Role" WHERE name = 'Manager' LIMIT 1)
WHERE "roleId" IN (SELECT id FROM "Role" WHERE name = 'SystemManager');

-- 3. Migrate users from UserPlanBasic, UserPlanMedium, UserPlanPremium, Member to User
UPDATE "User"
SET "roleId" = (SELECT id FROM "Role" WHERE name = 'User' LIMIT 1)
WHERE "roleId" IN (
  SELECT id FROM "Role"
  WHERE name IN ('UserPlanBasic', 'UserPlanMedium', 'UserPlanPremium', 'Member')
);

-- 4. Delete deprecated roles
DELETE FROM "Role"
WHERE name IN (
  'SystemAdmin',
  'SystemManager',
  'UserPlanBasic',
  'UserPlanMedium',
  'UserPlanPremium',
  'Member'
);
