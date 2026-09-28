-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "bookingChannel" TEXT,
ADD COLUMN     "firstVisit" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Appointment_bookingChannel_createdAt_idx" ON "Appointment"("bookingChannel", "createdAt");

