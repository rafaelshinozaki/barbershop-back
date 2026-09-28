import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Payment } from './payment.type';

@ObjectType()
export class Plan {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field()
  price: number;

  @Field()
  billingCycle: string;

  @Field(() => String, { nullable: true })
  features?: string | null;

  @Field(() => String, { nullable: true })
  stripePriceId?: string | null;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => String, { nullable: true })
  deleted_at?: string | null;
}

// Nome GraphQL "PlanSubscription": "Subscription" é o tipo raiz das
// subscriptions (WebSocket) e não pode ser usado por um tipo comum
@ObjectType('PlanSubscription')
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

  @Field(() => String, { nullable: true })
  stripeCustomerId?: string | null;

  @Field(() => String, { nullable: true })
  stripeSubscriptionId?: string | null;

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
