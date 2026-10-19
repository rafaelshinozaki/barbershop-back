-- CreateTable
CREATE TABLE "CouponReservation" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "couponId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CouponReservation_paymentIntentId_key" ON "CouponReservation"("paymentIntentId");

-- CreateIndex
CREATE INDEX "CouponReservation_couponId_expiresAt_idx" ON "CouponReservation"("couponId", "expiresAt");

-- CreateIndex
CREATE INDEX "CouponReservation_userId_couponId_idx" ON "CouponReservation"("userId", "couponId");

-- AddForeignKey
ALTER TABLE "CouponReservation" ADD CONSTRAINT "CouponReservation_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
