-- Espaço compartilhado (cadeira alugada): profissionais independentes que
-- atendem no espaço de outra barbearia
CREATE TABLE "SharedLocationMember" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hostBarbershopId" INTEGER NOT NULL,
    "memberBarbershopId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedByUserId" INTEGER,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "SharedLocationMember_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SharedLocationMember_memberBarbershopId_idx" ON "SharedLocationMember"("memberBarbershopId");
CREATE UNIQUE INDEX "SharedLocationMember_hostBarbershopId_memberBarbershopId_key" ON "SharedLocationMember"("hostBarbershopId", "memberBarbershopId");

ALTER TABLE "SharedLocationMember" ADD CONSTRAINT "SharedLocationMember_hostBarbershopId_fkey" FOREIGN KEY ("hostBarbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SharedLocationMember" ADD CONSTRAINT "SharedLocationMember_memberBarbershopId_fkey" FOREIGN KEY ("memberBarbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
