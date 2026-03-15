import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CouponsService, COUPON_TYPE } from './coupons.service';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/interfaces/roles';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async createCoupon(
    @Body()
    data: {
      code: string;
      name: string;
      description?: string;
      type: COUPON_TYPE;
      value: number;
      maxUses?: number;
      validFrom?: Date;
      validUntil?: Date;
      minSubscriptionMonths?: number;
      applicablePlans?: number[];
    },
  ) {
    return await this.couponsService.createCoupon(data);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async getAllCoupons() {
    return await this.couponsService.getAllCoupons();
  }

  @Get('my-coupons')
  async getMyCoupons(@Request() req) {
    return await this.couponsService.getCouponsForUser(req.user.id);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async getCouponById(@Param('id') id: string) {
    return await this.couponsService.getCouponById(parseInt(id));
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async updateCoupon(@Param('id') id: string, @Body() data: any) {
    return await this.couponsService.updateCoupon(parseInt(id), data);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async deleteCoupon(@Param('id') id: string) {
    return await this.couponsService.deleteCoupon(parseInt(id));
  }

  @Get(':id/stats')
  @UseGuards(RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  async getCouponStats(@Param('id') id: string) {
    return await this.couponsService.getCouponUsageStats(parseInt(id));
  }

  @Post('validate')
  async validateCoupon(
    @Request() req,
    @Body()
    data: {
      code: string;
      planId: number;
      amount: number;
    },
  ) {
    return await this.paymentsService.validateCoupon(
      data.code,
      req.user.id,
      data.planId,
      data.amount,
    );
  }

  @Post('apply/:paymentId')
  async applyCoupon(
    @Request() req,
    @Param('paymentId') paymentId: string,
    @Body() data: { code: string },
  ) {
    return await this.paymentsService.applyCouponToPayment(
      data.code,
      req.user.id,
      parseInt(paymentId),
    );
  }
}
