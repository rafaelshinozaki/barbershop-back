-- O profissional pode bloquear novos convites daquele espaço.
ALTER TABLE "SharedLocationMember" ADD COLUMN "invitesBlockedAt" TIMESTAMP(3);
