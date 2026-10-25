-- Pedido de avaliação pela equipe: um por atendimento (item 277)
ALTER TABLE "Appointment" ADD COLUMN "staffReviewRequestedAt" TIMESTAMP(3);
