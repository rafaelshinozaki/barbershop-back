import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { UserRole, MembershipStatus } from './enums';

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

registerEnumType(UserStatus, {
  name: 'UserStatus',
});

@ObjectType()
export class BackofficeStats {
  @Field(() => Int)
  totalUsers: number;

  @Field(() => Int)
  activeUsers: number;

  @Field(() => Int)
  newUsersThisMonth: number;

  @Field(() => Int)
  revenue: number;
}

@ObjectType()
export class ChartData {
  @Field(() => [String])
  labels: string[];

  @Field(() => [Int])
  data: number[];
}

@ObjectType()
export class UserGrowthData {
  @Field(() => ChartData)
  monthly: ChartData;

  @Field(() => ChartData)
  weekly: ChartData;
}

@ObjectType()
export class RoleDistribution {
  @Field(() => ChartData)
  roles: ChartData;
}

@ObjectType()
export class StatusDistribution {
  @Field(() => ChartData)
  status: ChartData;
}

@ObjectType()
export class PlanDistribution {
  @Field(() => ChartData)
  plans: ChartData;
}

@ObjectType()
export class GeographicAnalysis {
  @Field(() => ChartData)
  states: ChartData;

  @Field(() => ChartData)
  cities: ChartData;

  @Field(() => ChartData)
  countries: ChartData;
}

@ObjectType()
export class DemographicAnalysis {
  @Field(() => ChartData)
  gender: ChartData;

  @Field(() => ChartData)
  ageRanges: ChartData;
}

@ObjectType()
export class ProfessionalSegmentAnalysis {
  @Field(() => ChartData)
  segments: ChartData;

  @Field(() => ChartData)
  jobTitles: ChartData;

  @Field(() => ChartData)
  departments: ChartData;
}

@ObjectType()
export class CompanyAnalysis {
  @Field(() => ChartData)
  companies: ChartData;

  @Field(() => ChartData)
  companySizes: ChartData;
}

@ObjectType()
export class DetailedUser {
  @Field(() => Int)
  id: number;

  @Field()
  fullName: string;

  @Field()
  email: string;

  @Field()
  gender: string;

  @Field(() => Int, { nullable: true })
  age: number | null;

  @Field()
  ageRange: string;

  @Field()
  birthdate: string;

  @Field()
  country: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  company: string;

  @Field()
  professionalSegment: string;

  @Field()
  jobTitle: string;

  @Field()
  department: string;

  @Field(() => MembershipStatus)
  plan: MembershipStatus;

  @Field(() => UserStatus)
  status: UserStatus;

  @Field(() => UserRole)
  role: UserRole;

  @Field()
  createdAt: string;

  @Field()
  lastLogin: string;
}

@ObjectType()
export class DetailedUsersResponse {
  @Field(() => [DetailedUser])
  data: DetailedUser[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}

@ObjectType()
export class BackofficeDashboard {
  @Field(() => BackofficeStats)
  stats: BackofficeStats;

  @Field(() => UserGrowthData)
  userGrowth: UserGrowthData;

  @Field(() => RoleDistribution)
  roleDistribution: RoleDistribution;

  @Field(() => StatusDistribution)
  statusDistribution: StatusDistribution;

  @Field(() => PlanDistribution)
  planDistribution: PlanDistribution;
}

@ObjectType()
export class OverduePaymentDetail {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  userEmail: string;

  @Field()
  userName: string;

  @Field()
  userMembership: string;

  @Field()
  hasStripeCustomer: boolean;

  @Field()
  planName: string;

  @Field()
  planPrice: number;

  @Field()
  planBillingCycle: string;

  @Field()
  amount: number;

  @Field()
  nextPaymentDate: string;

  @Field(() => Int)
  daysOverdue: number;
}

@ObjectType()
export class UpcomingPaymentDetail {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  userEmail: string;

  @Field()
  userName: string;

  @Field()
  userMembership: string;

  @Field()
  hasStripeCustomer: boolean;

  @Field()
  planName: string;

  @Field()
  planPrice: number;

  @Field()
  planBillingCycle: string;

  @Field()
  amount: number;

  @Field()
  nextPaymentDate: string;

  @Field(() => Int)
  daysUntilPayment: number;
}

@ObjectType()
export class AdminRecurringPaymentsStats {
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

  @Field(() => [OverduePaymentDetail])
  overduePayments: OverduePaymentDetail[];

  @Field(() => [UpcomingPaymentDetail])
  upcomingPayments: UpcomingPaymentDetail[];
}

@ObjectType()
export class AdminProcessRecurringPaymentResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;

  @Field()
  processedAt: string;
}

@ObjectType()
export class AdminProcessAllRecurringPaymentsResponse {
  @Field()
  success: boolean;

  @Field()
  message: string;

  @Field()
  processedAt: string;

  @Field(() => Int)
  processedCount: number;
}

@ObjectType()
export class CompletedPayment {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  userId: number;

  @Field()
  userEmail: string;

  @Field()
  userName: string;

  @Field()
  userMembership: string;

  @Field()
  planName: string;

  @Field()
  planPrice: number;

  @Field()
  planBillingCycle: string;

  @Field()
  amount: number;

  @Field()
  paymentDate: string;

  @Field()
  nextPaymentDate: string;

  @Field()
  paymentMethod: string;

  @Field()
  transactionId: string;

  @Field()
  status: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class PaginatedCompletedPayments {
  @Field(() => [CompletedPayment])
  data: CompletedPayment[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  totalPages: number;
}
