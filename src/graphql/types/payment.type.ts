import { Field, ObjectType, Int, Float } from '@nestjs/graphql';
import { Plan } from './plan.type';

@ObjectType()
export class Payment {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  subscriptionId: number;

  @Field(() => Float)
  amount: number;

  @Field()
  paymentDate: string;

  @Field()
  nextPaymentDate: string;

  @Field({ nullable: true })
  paymentMethod?: string;

  @Field({ nullable: true })
  transactionId?: string;

  @Field()
  status: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field(() => Int, { nullable: true })
  daysOverdue?: number;
}

@ObjectType()
export class Card {
  @Field()
  brand: string;

  @Field()
  last4: string;

  @Field(() => Int)
  expMonth: number;

  @Field(() => Int)
  expYear: number;
}

@ObjectType()
export class PaymentMethod {
  @Field()
  id: string;

  @Field()
  type: string;

  @Field(() => Card, { nullable: true })
  card?: Card;
}

@ObjectType()
export class SetupIntent {
  @Field()
  client_secret: string;

  @Field()
  id: string;
}

@ObjectType()
export class PaymentIntentResponse {
  @Field()
  clientSecret: string;

  @Field()
  paymentIntentId: string;
}

@ObjectType()
export class SubscriptionPlan {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => Float)
  price: number;
}

@ObjectType()
export class SubscriptionResponse {
  @Field(() => Int)
  id: number;

  @Field()
  status: string;

  @Field(() => SubscriptionPlan)
  plan: SubscriptionPlan;
}

@ObjectType()
export class ConfirmPaymentIntentResponse {
  @Field()
  success: boolean;

  @Field(() => SubscriptionResponse, { nullable: true })
  subscription?: SubscriptionResponse;
}

@ObjectType()
export class DeletePaymentMethodResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;
}
