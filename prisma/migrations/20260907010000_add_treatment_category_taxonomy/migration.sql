-- CreateEnum
CREATE TYPE "TreatmentCategory" AS ENUM ('HAIR', 'BEARD', 'COMBO', 'COLORING', 'STYLING', 'NAILS', 'SKIN', 'BROWS_LASHES', 'MASSAGE', 'MAKEUP', 'WELLNESS', 'WAXING', 'OTHER');

-- Remap the one legacy free-text category value that isn't already a valid
-- enum label, before converting the column type (BarbershopService.category
-- and Barber.specialties were both untyped strings up to this point).
UPDATE "BarbershopService" SET "category" = 'HAIR' WHERE "category" = 'HAIRCUT';

-- AlterTable: BarbershopService.category (text -> TreatmentCategory), preserving data
ALTER TABLE "BarbershopService" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "BarbershopService" ALTER COLUMN "category" TYPE "TreatmentCategory" USING ("category"::text::"TreatmentCategory");
ALTER TABLE "BarbershopService" ALTER COLUMN "category" SET DEFAULT 'OTHER';

-- AlterTable: Barber.specialties (text[] -> TreatmentCategory[]), preserving data
ALTER TABLE "Barber" ALTER COLUMN "specialties" DROP DEFAULT;
ALTER TABLE "Barber" ALTER COLUMN "specialties" TYPE "TreatmentCategory"[] USING ("specialties"::text[]::"TreatmentCategory"[]);
ALTER TABLE "Barber" ALTER COLUMN "specialties" SET DEFAULT ARRAY[]::"TreatmentCategory"[];
