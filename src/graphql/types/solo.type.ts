import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class SoloPracticeType {
  @Field()
  active: boolean;

  @Field(() => Int, { nullable: true })
  barbershopId: number | null;

  @Field({ nullable: true })
  slug: string | null;

  @Field({ nullable: true })
  name: string | null;

  @Field(() => Int)
  completedThisMonth: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  remaining: number;

  @Field()
  nearLimit: boolean;

  @Field()
  grace: boolean;

  @Field()
  blocked: boolean;

  @Field(() => Int)
  productsThisMonth: number;

  @Field(() => Int)
  productLimit: number;

  @Field(() => Int)
  productRemaining: number;

  @Field()
  productNearLimit: boolean;

  @Field()
  productGrace: boolean;

  @Field()
  productBlocked: boolean;

  /** O preço do Pro está definido. */
  @Field()
  proAvailable: boolean;

  @Field()
  proActive: boolean;

  @Field({ nullable: true })
  proUntil: string | null;

  @Field()
  proPriceLabel: string;
}

@ObjectType()
export class ProReferralType {
  @Field()
  code: string;

  @Field(() => Int)
  priceCents: number;

  @Field()
  priceLabel: string;

  @Field(() => Int)
  months: number;

  @Field({ nullable: true })
  proUntil: string | null;

  @Field()
  proActive: boolean;

  @Field(() => Int)
  invitedCount: number;

  @Field()
  claimed: boolean;
}
