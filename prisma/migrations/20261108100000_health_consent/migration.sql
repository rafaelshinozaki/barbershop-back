-- AlterTable
ALTER TABLE "ConsentForm" ADD COLUMN     "healthConsentAt" TIMESTAMP(3),
ADD COLUMN     "healthConsentByUserId" INTEGER,
ADD COLUMN     "healthConsentRevokedAt" TIMESTAMP(3);

