-- O e-mail da resposta da unidade sai uma vez por avaliação (item 376)
ALTER TABLE "Review" ADD COLUMN "replyNotifiedAt" TIMESTAMP(3);
