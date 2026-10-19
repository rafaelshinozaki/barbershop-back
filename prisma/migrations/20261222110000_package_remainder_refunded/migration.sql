-- Pacote com o restante devolvido: desfazer uma baixa não devolve a sessão
ALTER TABLE "ClientPackage" ADD COLUMN "remainderRefundedAt" TIMESTAMP(3);
-- Os já devolvidos: "devolver o que sobrou" baixa o total para o usado e fecha
-- o pacote, então ele fica com menos sessões que a oferta comprada
UPDATE "ClientPackage" cp SET "remainderRefundedAt" = cp."updatedAt"
FROM "ServicePackage" sp
WHERE sp.id = cp."servicePackageId"
  AND cp.status = 'COMPLETED'
  AND cp."totalSessions" = cp."usedSessions"
  AND cp."totalSessions" < sp."totalSessions";
