-- Provedores de login social que a pessoa desconectou (item 485). O login
-- por esse provedor não religa sozinho pelo e-mail: é preciso entrar de
-- outro jeito e ligar de novo pela conta.
ALTER TABLE "User" ADD COLUMN "socialUnlinkedProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ClientAccount" ADD COLUMN "socialUnlinkedProviders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
