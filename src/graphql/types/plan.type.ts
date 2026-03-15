import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Payment } from './payment.type';

@ObjectType()
export class Plan {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  price: number;

  @Field()
  billingCycle: string;

  @Field({ nullable: true })
  features?: string;

  @Field({ nullable: true })
  stripePriceId?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field({ nullable: true })
  deleted_at?: string;
}

@ObjectType()
export class Subscription {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field(() => Int)
  planId: number;

  @Field()
  startSubDate: string;

  @Field({ nullable: true })
  cancelationDate?: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  stripeCustomerId?: string;

  @Field({ nullable: true })
  stripeSubscriptionId?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => Plan)
  plan: Plan;

  @Field(() => [Payment], { nullable: true })
  payments?: Payment[];
}

@ObjectType()
export class CreateSubscriptionResponse {
  @Field()
  success: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field(() => Subscription, { nullable: true })
  subscription?: Subscription;

  @Field({ nullable: true })
  checkoutUrl?: string;

  @Field({ nullable: true })
  clientSecret?: string;
}
