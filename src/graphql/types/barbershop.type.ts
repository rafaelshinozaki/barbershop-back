import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class Network {
  @Field(() => Int)
  id: number;

  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  logoUrl?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  mission?: string;

  @Field(() => Int, { nullable: true })
  foundationYear?: number;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class NetworkDashboardEvent {
  @Field()
  id: string;

  @Field()
  type: string;

  @Field()
  date: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  subtitle?: string;

  @Field(() => Float, { nullable: true })
  value?: number;
}

@ObjectType()
export class MonthlyRevenueItem {
  @Field()
  month: string;

  @Field(() => Int)
  year: number;

  @Field(() => Float)
  total: number;
}

@ObjectType()
export class NetworkDashboardStats {
  @Field(() => Int)
  totalBarbers: number;

  @Field(() => Int)
  totalBarbershops: number;

  @Field(() => Int)
  totalServicesDone: number;

  @Field(() => Int)
  totalProductsSold: number;

  @Field(() => Float)
  revenueThisMonth: number;

  @Field(() => [MonthlyRevenueItem])
  monthlyRevenue: MonthlyRevenueItem[];

  @Field(() => [NetworkDashboardEvent])
  recentEvents: NetworkDashboardEvent[];
}

@ObjectType()
export class Barbershop {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  address: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  country: string;

  @Field()
  postalCode: string;

  @Field()
  phone: string;

  @Field()
  email: string;

  @Field()
  timezone: string;

  @Field({ nullable: true })
  businessHours?: string;

  @Field()
  isActive: boolean;

  @Field(() => Int, { nullable: true })
  ownerUserId?: number;

  @Field(() => [String], {
    nullable: true,
    description:
      'Módulos disponíveis conforme o plano do dono (ex: clients, queue, appointments)',
  })
  availableModules?: string[];

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class BarbershopCustomer {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  networkId: number;

  @Field()
  name: string;

  @Field()
  phone: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  birthDate?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class Barber {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field(() => Int, { nullable: true })
  userId?: number;

  @Field()
  name: string;

  @Field()
  phone: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  specialization?: string;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  hireDate?: string;

  @Field({ nullable: true })
  staffType?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class BarberScheduleType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barberId: number;

  @Field(() => Int)
  dayOfWeek: number;

  @Field()
  startTime: string;

  @Field()
  endTime: string;

  @Field({ nullable: true })
  breakStart?: string;

  @Field({ nullable: true })
  breakEnd?: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class BarberTimeOffType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barberId: number;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field()
  reason: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class BarbershopServiceType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int)
  durationMinutes: number;

  @Field(() => Float)
  price: number;

  @Field()
  category: string;

  @Field()
  isActive: boolean;

  @Field(() => Int)
  displayOrder: number;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class BarbershopProductType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  sku?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float)
  salePrice: number;

  @Field(() => Float, { nullable: true })
  costPrice?: number;

  @Field()
  unit: string;

  @Field()
  isActive: boolean;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class Appointment {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field(() => Int)
  customerId: number;

  @Field(() => Int)
  barberId: number;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  notes?: string;

  @Field()
  source: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class WalkIn {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field(() => Int, { nullable: true })
  customerId?: number;

  @Field(() => Int, { nullable: true })
  barberId?: number;

  @Field()
  customerName: string;

  @Field({ nullable: true })
  customerPhone?: string;

  @Field()
  status: string;

  @Field(() => Int)
  queuePosition: number;

  @Field({ nullable: true })
  servedAt?: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class ServiceHistory {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field(() => Int)
  customerId: number;

  @Field(() => Int)
  barberId: number;

  @Field(() => Int, { nullable: true })
  appointmentId?: number;

  @Field(() => Int, { nullable: true })
  walkInId?: number;

  @Field(() => Int)
  serviceId: number;

  @Field()
  performedAt: string;

  @Field(() => Float)
  priceCharged: number;

  @Field(() => Int, { nullable: true })
  durationMinutes?: number;

  @Field({ nullable: true })
  notes?: string;

  @Field()
  createdAt: string;
}

@ObjectType()
export class Sale {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  barbershopId: number;

  @Field(() => Int, { nullable: true })
  customerId?: number;

  @Field(() => Int, { nullable: true })
  barberId?: number;

  @Field(() => Int, { nullable: true })
  appointmentId?: number;

  @Field()
  saleType: string;

  @Field(() => Float)
  subtotal: number;

  @Field(() => Float)
  discountAmount: number;

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float)
  total: number;

  @Field()
  paymentStatus: string;

  @Field({ nullable: true })
  paymentMethod?: string;

  @Field({ nullable: true })
  paidAt?: string;

  @Field()
  createdAt: string;
}

// Type aliases for resolver (naming consistency)
export const Customer = BarbershopCustomer;
export const BarberSchedule = BarberScheduleType;
export const BarberTimeOff = BarberTimeOffType;
export const BarbershopService = BarbershopServiceType;
export const BarbershopProduct = BarbershopProductType;
