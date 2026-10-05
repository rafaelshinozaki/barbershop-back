-- Boas-vindas por cargo: passos marcados e card dispensado, por pessoa e unidade
CREATE TABLE "OnboardingProgress" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "stepsDone" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dismissedAt" TIMESTAMP(3),
    CONSTRAINT "OnboardingProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingProgress_userId_barbershopId_key" ON "OnboardingProgress"("userId", "barbershopId");

ALTER TABLE "OnboardingProgress" ADD CONSTRAINT "OnboardingProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
