import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CouponsService, COUPON_TYPE } from '../../payments/coupons.service';
import { PaymentsService } from '../../payments/payments.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import {
  Coupon,
  CouponValidationResult,
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
  @Roles(Role.ADMIN)
  async getAllCoupons() {
    return await this.couponsService.getAllCoupons();
  }

  @Query(() => CouponStats, { name: 'couponStats' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async getCouponStats(@Args('id') id: number) {
    return await this.couponsService.getCouponUsageStats(id);
  }

  @Mutation(() => CouponValidationResult, { name: 'validateCoupon' })
  async validateCoupon(
    @Args('code') code: string,
    @Args('planId') planId: number,
    @Args('amount') amount: number,
    @Context() context: any,
  ) {
    const userId = context.req.user.id;
    return await this.paymentsService.validateCoupon(code, userId, planId, amount);
  }

  @Mutation(() => CouponValidationResult, { name: 'applyCoupon' })
  async applyCoupon(
    @Args('paymentId') paymentId: number,
    @Args('code') code: string,
    @Context() context: any,
  ) {
    const userId = context.req.user.id;
    return await this.paymentsService.applyCouponToPayment(code, userId, paymentId);
  }

  @Mutation(() => Coupon, { name: 'createCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async createCoupon(@Args('data') data: CreateCouponInput) {
    const couponData = {
      ...data,
      applicablePlans: data.applicablePlans ? JSON.parse(data.applicablePlans) : undefined,
    };
    return await this.couponsService.createCoupon(couponData);
  }

  @Mutation(() => Coupon, { name: 'updateCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async updateCoupon(@Args('id') id: number, @Args('data') data: UpdateCouponInput) {
    const updateData = {
      ...data,
      applicablePlans: data.applicablePlans ? JSON.parse(data.applicablePlans) : undefined,
    };
    return await this.couponsService.updateCoupon(id, updateData);
  }

  @Mutation(() => DeleteCouponResponse, { name: 'deleteCoupon' })
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async deleteCoupon(@Args('id') id: number) {
    await this.couponsService.deleteCoupon(id);
    return { success: true, message: 'Cupom deletado com sucesso' };
  }
}
