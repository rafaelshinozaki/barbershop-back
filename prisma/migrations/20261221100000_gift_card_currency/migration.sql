-- Moeda do vale-presente (item 188): a da unidade que vendeu. Os vales que
-- já existem ficam na moeda da rede, que era a única até a moeda por unidade.
ALTER TABLE "GiftCard" ADD COLUMN "currency" TEXT;
UPDATE "GiftCard" g SET "currency" = n."currency" FROM "Network" n WHERE n.id = g."networkId";
