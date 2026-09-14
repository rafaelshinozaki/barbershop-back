-- AlterTable
ALTER TABLE "Barbershop" ADD COLUMN     "subdomain" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Barbershop_subdomain_key" ON "Barbershop"("subdomain");

