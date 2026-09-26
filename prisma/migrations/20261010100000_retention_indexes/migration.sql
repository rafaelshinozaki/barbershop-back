-- Índice para a tarefa diária achar o que venceu sem varrer a tabela inteira.
CREATE INDEX "EmailLogger_createdAt_idx" ON "EmailLogger"("createdAt");
CREATE INDEX "LoginHistory_createdAt_idx" ON "LoginHistory"("createdAt");
CREATE INDEX "UserNotification_createdAt_idx" ON "UserNotification"("createdAt");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");
