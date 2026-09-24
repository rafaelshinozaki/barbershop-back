import { Field, ObjectType, Int, Float } from '@nestjs/graphql';

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
export class UseSavedCardResponse {
  /** O plano estava em atraso (e a cobrança foi tentada com o cartão novo) */
  @Field()
  overdue: boolean;

  /** renewed | failed | in_progress | expired | not_due — null se não estava em atraso */
  @Field(() => String, { nullable: true })
  outcome: string | null;
}

@ObjectType()
export class PaymentIntentResponse {
  /** null quando o cupom cobriu o valor e o plano já foi ativado sem cobrança */
  @Field(() => String, { nullable: true })
  clientSecret: string | null;

  @Field(() => String, { nullable: true })
  paymentIntentId: string | null;

  /** true = plano ativado sem passar pelo Stripe (cupom de 100%) */
  @Field({ defaultValue: false })
  activated: boolean;

  @Field(() => Float, { nullable: true })
  originalAmount?: number;

  @Field(() => Float, { nullable: true })
  discountAmount?: number;

  @Field(() => Float, { nullable: true })
  finalAmount?: number;
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

@ObjectType()
export class ChangePlanResponse {
  @Field()
  success: boolean;

  @Field({ nullable: true })
  message?: string;

  @Field(() => SubscriptionResponse, { nullable: true })
  subscription?: SubscriptionResponse;
}
