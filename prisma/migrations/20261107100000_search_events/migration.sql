-- CreateTable
CREATE TABLE "SearchEvent" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "city" TEXT,
    "category" "TreatmentCategory",
    "hasPoint" BOOLEAN NOT NULL DEFAULT false,
    "resultCount" INTEGER NOT NULL,
    "topBarbershopIds" INTEGER[],
    "evaluatedAt" TIMESTAMP(3),
    "foundWithin48h" BOOLEAN,

    CONSTRAINT "SearchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchEvent_evaluatedAt_idx" ON "SearchEvent"("evaluatedAt");

-- CreateIndex
CREATE INDEX "SearchEvent_createdAt_idx" ON "SearchEvent"("createdAt");

