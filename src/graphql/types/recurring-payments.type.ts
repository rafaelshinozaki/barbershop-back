import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class OverduePayment {
  @Field(() => Int)
  id: number;

  @Field()
  planName: string;

  @Field()
  amount: number;

  @Field()
  nextPaymentDate: string;

  @Field(() => Int)
  daysOverdue: number;
}

@ObjectType()
export class UpcomingPayment {
  @Field(() => Int)
  id: number;

  @Field()
  planName: string;

  @Field()
  amount: number;

  @Field()
  nextPaymentDate: string;

  @Field(() => Int)
  daysUntilPayment: number;
}

@ObjectType()
export class UserRecurringPaymentsStats {
  @Field(() => Int)
  overdueCount: number;

  @Field(() => Int)
  upcomingCount: number;

  @Field()
  lastCheck: string;

  @Field()
  timezone: string;

  @Field()
  nextScheduledRun: string;

  @Field(() => [OverduePayment])
  overduePayments: OverduePayment[];

  @Field(() => [UpcomingPayment])
  upcomingPayments: UpcomingPayment[];
}

@ObjectType()
export class ProcessRecurringPaymentResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;

  @Field()
  processedAt: string;
}

@ObjectType()
export class ProcessAllRecurringPaymentsResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;

  @Field()
  processedAt: string;

  @Field(() => Int)
  processedCount: number;
}
