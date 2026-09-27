-- Avisos de chat gravados com um tipo fora do enum do sininho (quebrava a lista)
UPDATE "UserNotification" SET "type" = 'INFO' WHERE "type" = 'chat';
