-- Login social também pede o código das duas etapas (opção da conta, item 315)
ALTER TABLE "User" ADD COLUMN "socialLoginTwoFactor" BOOLEAN NOT NULL DEFAULT false;
