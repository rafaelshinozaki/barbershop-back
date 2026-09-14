-- CreateTable
CREATE TABLE "SocialConnection" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "facebookPageId" TEXT NOT NULL,
    "facebookPageName" TEXT NOT NULL,
    "facebookAccessToken" TEXT NOT NULL,
    "instagramBusinessAccountId" TEXT,
    "instagramUsername" TEXT,
    "connectedByUserId" INTEGER NOT NULL,

    CONSTRAINT "SocialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "barbershopId" INTEGER NOT NULL,
    "createdByUserId" INTEGER NOT NULL,
    "caption" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "postToFacebook" BOOLEAN NOT NULL DEFAULT true,
    "postToInstagram" BOOLEAN NOT NULL DEFAULT true,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "publishedAt" TIMESTAMP(3),
    "facebookPostId" TEXT,
    "instagramMediaId" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SocialConnection_barbershopId_key" ON "SocialConnection"("barbershopId");

-- CreateIndex
CREATE INDEX "SocialConnection_barbershopId_idx" ON "SocialConnection"("barbershopId");

-- CreateIndex
CREATE INDEX "SocialPost_barbershopId_idx" ON "SocialPost"("barbershopId");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledFor_idx" ON "SocialPost"("status", "scheduledFor");

-- AddForeignKey
ALTER TABLE "SocialConnection" ADD CONSTRAINT "SocialConnection_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

