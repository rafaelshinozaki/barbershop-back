-- Denúncia e ocultação da capa, do logo, da foto do profissional e do post publicado (item 229)
ALTER TABLE "Barbershop" ADD COLUMN "coverHiddenAt" TIMESTAMP(3),
ADD COLUMN "logoHiddenAt" TIMESTAMP(3);

ALTER TABLE "Barber" ADD COLUMN "avatarHiddenAt" TIMESTAMP(3);

ALTER TABLE "SocialPost" ADD COLUMN "hiddenAt" TIMESTAMP(3);
