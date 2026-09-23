import { Resolver, Query, Mutation, Args, Context, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CouponsService } from '../../payments/coupons.service';
import { PaymentsService } from '../../payments/payments.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import {
  Coupon,
  CouponValidationResult,
  ApplyCouponResult,
  CouponStats,
  DeleteCouponResponse,
  CreateCouponInput,
  UpdateCouponInput,
} from '../types/coupon.type';

@Resolver('Coupon')
@UseGuards(GraphQLJwtAuthGuard)
export class CouponsResolver {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Query(() => [Coupon], { name: 'myCoupons' })
  async getMyCoupons(@Context() context: any) {
    const userId = context.req.user.id;
    return await this.couponsService.getCouponsForUser(userId);
  }

  @Query(() => [Coupon], { name: 'allCoupons' })
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async getAllCoupons() {
    return await this.couponsService.getAllCoupons();
  }

  @Query(() => CouponStats, { name: 'couponStats' })
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async getCouponStats(@Args('id', { type: () => Int }) id: number): Promise<CouponStats> {
    // O service devolve o cupom com os usos (formato do REST); o tipo
    // GraphQL são os totais — antes ia o cupom cru e todo campo vinha null
    // ("Cannot return null for non-nullable field CouponStats.totalUses")
    const coupon = await this.couponsService.getCouponUsageStats(id);
    const discounts = coupon.payments.map((p) => Number(p.discountAmount ?? 0));
    const totalDiscount = discounts.reduce((sum, d) => sum + d, 0);
    return {
      totalUses: coupon.usedCount,
      uniqueUsers: new Set(coupon.userCoupons.map((uc) => uc.userId)).size,
      totalDiscount,
      averageDiscount: discounts.length ? totalDiscount / discounts.length : 0,
    };
  }

  @Mutation(() => CouponValidationResult, { name: 'validateCoupon' })
  async validateCoupon(
    @Args('code') code: string,
    @Args('planId', { type: () => Int }) planId: number,
    @Args('amount') amount: number,
    @Context() context: any,
  ) {
    const userId = context.req.user.id;
    return await this.paymentsService.validateCoupon(code, userId, planId, amount);
  }

  // O service devolve { success, finalAmount, discountAmount, coupon } — o tipo
  // antigo (CouponValidationResult) não batia e a resposta sempre quebrava
  @Mutation(() => ApplyCouponResult, { name: 'applyCoupon' })
  async applyCoupon(
    @Args('paymentId', { type: () => Int }) paymentId: number,
    @Args('code') code: string,
    @Context() context: any,
  ) {
    const userId = context.req.user.id;
    return await this.paymentsService.applyCouponToPayment(code, userId, paymentId);
  }

  @Mutation(() => Coupon, { name: 'createCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async createCoupon(@Args('data') data: CreateCouponInput) {
    const couponData = {
      ...data,
      applicablePlans: data.applicablePlans ? JSON.parse(data.applicablePlans) : undefined,
    };
    return await this.couponsService.createCoupon(couponData);
  }

  @Mutation(() => Coupon, { name: 'updateCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async updateCoupon(
    @Args('id', { type: () => Int }) id: number,
    @Args('data') data: UpdateCouponInput,
  ) {
    const updateData = {
      ...data,
      applicablePlans: data.applicablePlans ? JSON.parse(data.applicablePlans) : undefined,
    };
    return await this.couponsService.updateCoupon(id, updateData);
  }

  @Mutation(() => DeleteCouponResponse, { name: 'deleteCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async deleteCoupon(@Args('id', { type: () => Int }) id: number) {
    await this.couponsService.deleteCoupon(id);
    return { success: true, message: 'Cupom deletado com sucesso' };
  }
}
