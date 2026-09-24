-- CreateTable
CREATE TABLE "CalendarFeed" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,
    "barbershopId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastAccessAt" TIMESTAMP(3),

    CONSTRAINT "CalendarFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_tokenHash_key" ON "CalendarFeed"("tokenHash");

-- CreateIndex
CREATE INDEX "CalendarFeed_barbershopId_idx" ON "CalendarFeed"("barbershopId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeed_userId_barbershopId_scope_key" ON "CalendarFeed"("userId", "barbershopId", "scope");

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarFeed" ADD CONSTRAINT "CalendarFeed_barbershopId_fkey" FOREIGN KEY ("barbershopId") REFERENCES "Barbershop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

