-- Capa e galeria da página pública; foto enviada do profissional
ALTER TABLE "Barbershop" ADD COLUMN "coverKey" TEXT;

ALTER TABLE "Barber" ADD COLUMN "avatarKey" TEXT;

CREATE TABLE "BarbershopPhoto" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BarbershopPhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BarbershopPhoto_barbershopId_position_idx" ON "BarbershopPhoto"("barbershopId", "position");

ALTER TABLE "BarbershopPhoto" ADD CONSTRAINT "BarbershopPhoto_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
