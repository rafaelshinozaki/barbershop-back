import { Prisma } from '@prisma/client';
import { CouponsResolver } from './coupons.resolver';

describe('CouponsResolver.getCouponStats', () => {
  const make = (coupon: unknown) =>
    new CouponsResolver({ getCouponUsageStats: async () => coupon } as never, {} as never);

  it('soma os usos do cupom (antes voltava o cupom cru e a query quebrava)', async () => {
    const stats = await make({
      usedCount: 3,
      userCoupons: [{ userId: 1 }, { userId: 2 }, { userId: 1 }],
      payments: [
        { discountAmount: new Prisma.Decimal(10) },
        { discountAmount: new Prisma.Decimal(5.5) },
        { discountAmount: null },
      ],
    }).getCouponStats(1);
    expect(stats).toEqual({
      totalUses: 3,
      uniqueUsers: 2,
      totalDiscount: 15.5,
      averageDiscount: 15.5 / 3,
    });
  });

  it('cupom sem uso nenhum: zeros, não null', async () => {
    const stats = await make({ usedCount: 0, userCoupons: [], payments: [] }).getCouponStats(1);
    expect(stats).toEqual({ totalUses: 0, uniqueUsers: 0, totalDiscount: 0, averageDiscount: 0 });
  });
});
