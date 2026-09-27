-- Profissional favorito do cliente (na unidade em que atende)
CREATE TABLE "ClientFavoriteBarber" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAccountId" INTEGER NOT NULL,
    "barberId" INTEGER NOT NULL,

    CONSTRAINT "ClientFavoriteBarber_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientFavoriteBarber_clientAccountId_barberId_key" ON "ClientFavoriteBarber"("clientAccountId", "barberId");
CREATE INDEX "ClientFavoriteBarber_barberId_idx" ON "ClientFavoriteBarber"("barberId");

ALTER TABLE "ClientFavoriteBarber" ADD CONSTRAINT "ClientFavoriteBarber_clientAccountId_fkey" FOREIGN KEY ("clientAccountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientFavoriteBarber" ADD CONSTRAINT "ClientFavoriteBarber_barberId_fkey" FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
