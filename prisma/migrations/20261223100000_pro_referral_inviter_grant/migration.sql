-- Mês de quem indicou só depois de um atendimento de verdade na conta indicada (item 239)
ALTER TABLE "ProReferral" ADD COLUMN "inviterGrantedAt" TIMESTAMP(3);

-- As indicações já aceitas já deram o mês a quem indicou
UPDATE "ProReferral" SET "inviterGrantedAt" = "createdAt";
