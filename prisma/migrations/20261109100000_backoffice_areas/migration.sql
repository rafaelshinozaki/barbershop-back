-- Áreas do backoffice liberadas para a equipe do sistema (SystemManager)
ALTER TABLE "User" ADD COLUMN "backofficeAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Quem já é SystemManager continua com o acesso de antes (todas as áreas);
-- o admin tira o que não for da pessoa
UPDATE "User" SET "backofficeAreas" = ARRAY['support', 'moderation', 'users', 'finance', 'operations']
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name" = 'SystemManager');
