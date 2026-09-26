-- Agenda por conta própria: uma unidade de uma pessoa, fora da cota de unidades do plano.
ALTER TABLE "Barbershop" ADD COLUMN "practiceKind" TEXT NOT NULL DEFAULT 'shop';

ALTER TABLE "Barbershop" ADD CONSTRAINT "Barbershop_practiceKind_check"
  CHECK ("practiceKind" IN ('shop', 'solo'));

CREATE INDEX "Barbershop_ownerUserId_practiceKind_idx" ON "Barbershop"("ownerUserId", "practiceKind");
