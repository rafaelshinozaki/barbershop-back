-- CreateTable
CREATE TABLE "SocialPageChoice" (
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "userToken" TEXT NOT NULL,

    CONSTRAINT "SocialPageChoice_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "SocialPageChoice_expiresAt_idx" ON "SocialPageChoice"("expiresAt");

-- AddForeignKey
ALTER TABLE "SocialPageChoice" ADD CONSTRAINT "SocialPageChoice_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
