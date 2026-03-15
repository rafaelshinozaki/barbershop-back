import { Field, ObjectType, Int, Float, InputType, registerEnumType } from '@nestjs/graphql';
import { COUPON_TYPE } from '../../payments/coupons.service';

registerEnumType(COUPON_TYPE, {
  name: 'CouponType',
  description: 'The type of coupon',
});

@ObjectType()
export class Coupon {
  @Field(() => Int)
  id: number;

  @Field()
  code: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => COUPON_TYPE)
  type: COUPON_TYPE;

  @Field(() => Float)
  value: number;

  @Field(() => Int, { nullable: true })
  maxUses?: number;

  @Field(() => Int)
  usedCount: number;

  @Field()
  isActive: boolean;

  @Field()
  validFrom: string;

  @Field({ nullable: true })
  validUntil?: string;

  @Field(() => Int, { nullable: true })
  minSubscriptionMonths?: number;

  @Field({ nullable: true })
  applicablePlans?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field({ nullable: true })
  deleted_at?: string;
}

@InputType()
export class CreateCouponInput {
  @Field()
  code: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => COUPON_TYPE)
  type: COUPON_TYPE;

  @Field(() => Float)
  value: number;

  @Field(() => Int, { nullable: true })
  maxUses?: number;

  @Field({ nullable: true })
  validFrom?: Date;

  @Field({ nullable: true })
  validUntil?: Date;

  @Field(() => Int, { nullable: true })
  minSubscriptionMonths?: number;

  @Field({ nullable: true })
  applicablePlans?: string;
}

@InputType()
export class UpdateCouponInput {
  @Field({ nullable: true })
  code?: string;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => COUPON_TYPE, { nullable: true })
  type?: COUPON_TYPE;

  @Field(() => Float, { nullable: true })
  value?: number;

  @Field(() => Int, { nullable: true })
  maxUses?: number;

  @Field({ nullable: true })
  validFrom?: Date;

  @Field({ nullable: true })
  validUntil?: Date;

  @Field(() => Int, { nullable: true })
  minSubscriptionMonths?: number;

  @Field({ nullable: true })
  applicablePlans?: string;
}

@ObjectType()
export class CouponValidationResult {
  @Field()
  isValid: boolean;

  @Field({ nullable: true })
  error?: string;

  @Field(() => Coupon, { nullable: true })
  coupon?: Coupon;

  @Field(() => Float, { nullable: true })
  discountAmount?: number;

  @Field(() => Float, { nullable: true })
  originalAmount?: number;
}

@ObjectType()
export class CouponStats {
  @Field(() => Int)
  totalUses: number;

  @Field(() => Int)
  uniqueUsers: number;

  @Field(() => Float)
  totalDiscount: number;

  @Field(() => Float)
  averageDiscount: number;
}

@ObjectType()
export class DeleteCouponResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;
} 