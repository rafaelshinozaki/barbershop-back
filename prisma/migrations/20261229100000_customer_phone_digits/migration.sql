-- Dígitos do telefone da ficha, pra achar quem respondeu SAIR sem varrer
-- a tabela com regexp_replace (item 265). A coluna se recalcula sozinha.
ALTER TABLE "Customer" ADD COLUMN "phoneDigits" TEXT
  GENERATED ALWAYS AS (regexp_replace(phone, '\D', '', 'g')) STORED;

CREATE INDEX "Customer_phoneDigits_idx" ON "Customer" ("phoneDigits");
