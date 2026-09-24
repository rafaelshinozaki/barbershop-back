-- Feriados e fechamentos da unidade (dia fechado ou horário especial)

-- CreateTable
CREATE TABLE "BarbershopClosure" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "date" TEXT NOT NULL,
    "openTime" TEXT,
    "closeTime" TEXT,
    "reason" TEXT,
    "createdByUserId" INTEGER,

    CONSTRAINT "BarbershopClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BarbershopClosure_barbershopId_date_key" ON "BarbershopClosure"("barbershopId", "date");

-- AddForeignKey
ALTER TABLE "BarbershopClosure" ADD CONSTRAINT "BarbershopClosure_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
