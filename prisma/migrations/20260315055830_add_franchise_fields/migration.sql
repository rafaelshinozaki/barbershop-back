-- DropForeignKey
ALTER TABLE "Network" DROP CONSTRAINT "Network_ownerUserId_fkey";

-- AlterTable
ALTER TABLE "Network" ADD COLUMN     "city" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "foundationYear" INTEGER,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "mission" TEXT;

-- AddForeignKey
ALTER TABLE "Network" ADD CONSTRAINT "Network_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
