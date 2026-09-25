-- Coordenadas (pelo IP) do login e da sessão, pro mapa no detalhe; o login
-- guarda a sessão que abriu, pra dizer se ela ainda está ativa
ALTER TABLE "LoginHistory" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "sessionToken" TEXT;

ALTER TABLE "ActiveSession" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
