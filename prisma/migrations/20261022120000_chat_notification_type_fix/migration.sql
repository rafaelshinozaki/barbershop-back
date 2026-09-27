-- O enum do sininho guarda em minúsculas ('info'); a correção anterior gravou 'INFO'
UPDATE "UserNotification" SET "type" = 'info' WHERE "type" IN ('chat', 'INFO');
