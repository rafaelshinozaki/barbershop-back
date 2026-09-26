-- Perfil público do profissional, desligado até a pessoa escolher.
ALTER TABLE "Professional" ADD COLUMN "slug" TEXT;
ALTER TABLE "Professional" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Professional_slug_key" ON "Professional"("slug");
