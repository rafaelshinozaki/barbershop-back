-- Descadastro do WhatsApp separado do e-mail (item 275): SAIR no WhatsApp
-- não tira mais a pessoa das campanhas por e-mail nem das outras redes.
CREATE TABLE "WhatsappOptOut" (
    "phoneDigits" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappOptOut_pkey" PRIMARY KEY ("phoneDigits")
);
