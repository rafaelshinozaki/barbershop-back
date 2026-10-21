-- Origem da avaliação pelo link: e-mail automático ou pedido da equipe.
ALTER TABLE "Review" ADD COLUMN "reviewSource" TEXT;
ALTER TABLE "Review" ADD COLUMN "requestedByUserId" INTEGER;
ALTER TABLE "ProfessionalReview" ADD COLUMN "reviewSource" TEXT;
ALTER TABLE "ProfessionalReview" ADD COLUMN "requestedByUserId" INTEGER;
