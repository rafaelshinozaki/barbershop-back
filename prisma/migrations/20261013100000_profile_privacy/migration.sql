-- Visibilidade e o que o perfil de profissional mostra. O padrão continua oculto.
ALTER TABLE "Professional" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'hidden';
ALTER TABLE "Professional" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Professional" ADD COLUMN "specialties" "TreatmentCategory"[] NOT NULL DEFAULT ARRAY[]::"TreatmentCategory"[];
ALTER TABLE "Professional" ADD COLUMN "cities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Professional" ADD COLUMN "openToWork" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Professional" ADD COLUMN "engagements" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Professional" ADD COLUMN "acceptedRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Professional" ADD COLUMN "acceptingClients" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showPhoto" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showRating" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showAppointmentCount" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showReviews" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showWorkHistory" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showLocations" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Professional" ADD COLUMN "showContact" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Professional" SET "visibility" = 'public' WHERE "isPublic" = true;

ALTER TABLE "Professional" ADD CONSTRAINT "Professional_visibility_check"
  CHECK ("visibility" IN ('hidden', 'platform', 'public'));
