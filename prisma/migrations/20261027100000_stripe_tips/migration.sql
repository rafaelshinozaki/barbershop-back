-- AlterTable
ALTER TABLE "AppointmentTip" ADD COLUMN     "stripePaymentIntentId" TEXT,
ALTER COLUMN "createdByUserId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentTip_stripePaymentIntentId_key" ON "AppointmentTip"("stripePaymentIntentId");

