-- Uma rede por dono. O "procura e cria" sem trava abria duas no mesmo instante.
-- Duplicata vazia (sem unidade, cliente, cartão ou indicação) sai; se sobrar
-- dado, o índice único falha em vez de apagar histórico.
DELETE FROM "Network" extra
WHERE EXISTS (
  SELECT 1 FROM "Network" keeper
  WHERE keeper."ownerUserId" = extra."ownerUserId"
    AND keeper.id < extra.id
)
AND NOT EXISTS (SELECT 1 FROM "Barbershop" b WHERE b."networkId" = extra.id)
AND NOT EXISTS (SELECT 1 FROM "Customer" c WHERE c."networkId" = extra.id)
AND NOT EXISTS (SELECT 1 FROM "GiftCard" g WHERE g."networkId" = extra.id)
AND NOT EXISTS (SELECT 1 FROM "CustomerReferral" r WHERE r."networkId" = extra.id);

DROP INDEX "Network_ownerUserId_idx";

CREATE UNIQUE INDEX "Network_ownerUserId_key" ON "Network"("ownerUserId");
