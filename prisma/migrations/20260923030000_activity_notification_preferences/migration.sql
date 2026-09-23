-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "appointmentsEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "appointmentsInApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "salesEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "salesInApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inventoryEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inventoryInApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "teamEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "teamInApp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reviewsEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewsInApp" BOOLEAN NOT NULL DEFAULT true;
