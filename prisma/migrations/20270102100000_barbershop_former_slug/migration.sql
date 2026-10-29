-- Endereço antigo da página, reservado por um ano (item 400)
CREATE TABLE "BarbershopFormerSlug" (
    "slug" TEXT NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarbershopFormerSlug_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "BarbershopFormerSlug_barbershopId_idx" ON "BarbershopFormerSlug"("barbershopId");

ALTER TABLE "BarbershopFormerSlug" ADD CONSTRAINT "BarbershopFormerSlug_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
