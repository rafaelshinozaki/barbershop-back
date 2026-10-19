-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "depositCashSessionId" INTEGER,
ADD COLUMN     "depositManualMethod" TEXT,
ADD COLUMN     "depositReceivedAt" TIMESTAMP(3),
ADD COLUMN     "depositReceivedByUserId" INTEGER;
