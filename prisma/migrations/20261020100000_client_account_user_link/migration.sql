-- AlterTable
ALTER TABLE "ClientAccount" ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "userId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "ClientAccount_userId_key" ON "ClientAccount"("userId");

-- AddForeignKey
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
