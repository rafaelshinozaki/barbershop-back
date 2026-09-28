-- AlterTable
ALTER TABLE "WaitlistEntry" ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'staff';

