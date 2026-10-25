-- Publicação dos posts com reserva (item 266): duas execuções do agendador
-- não publicam o mesmo post.
ALTER TABLE "SocialPost" ADD COLUMN "publishingAt" TIMESTAMP(3);
