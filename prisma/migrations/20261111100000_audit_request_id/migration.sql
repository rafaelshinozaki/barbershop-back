-- Id do request (x-request-id) no registro de ações do backoffice
ALTER TABLE "BackofficeAuditLog" ADD COLUMN "requestId" TEXT;
