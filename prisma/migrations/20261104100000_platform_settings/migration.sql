-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" INTEGER,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

