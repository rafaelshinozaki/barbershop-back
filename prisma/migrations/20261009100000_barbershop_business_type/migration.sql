-- Tipo de estabelecimento (barbearia, salão, esmalteria...); as unidades que já existem são barbearias
ALTER TABLE "Barbershop" ADD COLUMN "businessType" TEXT NOT NULL DEFAULT 'barbershop';
