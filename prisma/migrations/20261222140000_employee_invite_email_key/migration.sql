-- AlterTable
ALTER TABLE "EmployeeInvite" ADD COLUMN     "emailKeyHash" TEXT,
ADD COLUMN     "emailKeySentAt" TIMESTAMP(3);
