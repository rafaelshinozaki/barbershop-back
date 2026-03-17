import { InputType, Field, Int, Float } from '@nestjs/graphql';

// ============ Barbershop ============
@InputType()
export class CreateBarbershopInput {
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

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  businessHours?: string;
}

@InputType()
export class UpdateBarbershopInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  address?: string;

  @Field({ nullable: true })
  city?: string;

  @Field({ nullable: true })
  state?: string;

  @Field({ nullable: true })
  country?: string;

  @Field({ nullable: true })
  postalCode?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  timezone?: string;

  @Field({ nullable: true })
  businessHours?: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

// ============ Network / Franchise ============
@InputType()
export class UpdateNetworkInput {
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
}

// ============ Customer ============
@InputType()
export class CreateCustomerInput {
  @Field(() => Int, { nullable: true, description: 'Opcional - usa barbershopId da mutation' })
  barbershopId?: number;

  @Field()
  name: string;

  @Field({ nullable: true, description: 'Obrigatório se email não informado' })
  phone?: string;

  @Field({ nullable: true, description: 'Obrigatório se telefone não informado' })
  email?: string;

  @Field({ nullable: true })
  birthDate?: string;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class UpdateCustomerInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  birthDate?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

// ============ Barber ============
@InputType()
export class CreateBarberInput {
  @Field(() => Int)
  barbershopId: number;

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

  @Field({ nullable: true })
  hireDate?: string;

  @Field({ nullable: true })
  userId?: number;
}

@InputType()
export class UpdateBarberInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  specialization?: string;

  @Field({ nullable: true })
  hireDate?: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field({ nullable: true })
  userId?: number;
}

// ============ BarberSchedule ============
@InputType()
export class CreateBarberScheduleInput {
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
}

@InputType()
export class UpdateBarberScheduleInput {
  @Field({ nullable: true })
  startTime?: string;

  @Field({ nullable: true })
  endTime?: string;

  @Field({ nullable: true })
  breakStart?: string;

  @Field({ nullable: true })
  breakEnd?: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

// ============ BarberTimeOff ============
@InputType()
export class CreateBarberTimeOffInput {
  @Field(() => Int)
  barberId: number;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field({ defaultValue: 'PERSONAL' })
  reason: string;
}

// ============ BarbershopService ============
@InputType()
export class CreateBarbershopServiceInput {
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

  @Field({ nullable: true, defaultValue: 0 })
  displayOrder?: number;
}

@InputType()
export class UpdateBarbershopServiceInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Int, { nullable: true })
  durationMinutes?: number;

  @Field(() => Float, { nullable: true })
  price?: number;

  @Field({ nullable: true })
  category?: string;

  @Field(() => Int, { nullable: true })
  displayOrder?: number;

  @Field({ nullable: true })
  isActive?: boolean;
}

// ============ BarbershopProduct ============
@InputType()
export class CreateBarbershopProductInput {
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

  @Field({ nullable: true, defaultValue: 'UNIT' })
  unit?: string;
}

@InputType()
export class UpdateBarbershopProductInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  sku?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => Float, { nullable: true })
  salePrice?: number;

  @Field(() => Float, { nullable: true })
  costPrice?: number;

  @Field({ nullable: true })
  unit?: string;

  @Field({ nullable: true })
  isActive?: boolean;
}

// ============ Appointment ============
@InputType()
export class AppointmentServiceInput {
  @Field(() => Int)
  serviceId: number;

  @Field({ nullable: true, defaultValue: 1 })
  quantity?: number;

  @Field(() => Float)
  unitPrice: number;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateAppointmentInput {
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

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true, defaultValue: 'PHONE' })
  source?: string;

  @Field(() => [AppointmentServiceInput])
  services: AppointmentServiceInput[];
}

@InputType()
export class UpdateAppointmentInput {
  @Field(() => Int, { nullable: true })
  customerId?: number;

  @Field(() => Int, { nullable: true })
  barberId?: number;

  @Field({ nullable: true })
  startAt?: string;

  @Field({ nullable: true })
  endAt?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field({ nullable: true })
  status?: string;
}

// ============ WalkIn ============
@InputType()
export class WalkInServiceInput {
  @Field(() => Int)
  serviceId: number;

  @Field({ nullable: true, defaultValue: 1 })
  quantity?: number;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateWalkInInput {
  @Field(() => Int)
  barbershopId: number;

  @Field()
  customerName: string;

  @Field({ nullable: true })
  customerPhone?: string;

  @Field({ nullable: true })
  customerId?: number;

  @Field({ nullable: true })
  barberId?: number;

  @Field(() => [WalkInServiceInput])
  services: WalkInServiceInput[];
}

// ============ Sale ============
@InputType()
export class CreateSaleItemInput {
  @Field()
  itemType: string;

  @Field(() => Int, { nullable: true })
  serviceId?: number;

  @Field(() => Int, { nullable: true })
  productId?: number;

  @Field(() => Int, { nullable: true })
  serviceHistoryId?: number;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  unitPrice: number;

  @Field(() => Float)
  totalPrice: number;

  @Field({ nullable: true })
  notes?: string;
}

@InputType()
export class CreateSaleInput {
  @Field(() => Int, { nullable: true })
  customerId?: number;

  @Field(() => Int, { nullable: true })
  barberId?: number;

  @Field(() => Int, { nullable: true })
  appointmentId?: number;

  @Field()
  saleType: string;

  @Field(() => [CreateSaleItemInput])
  items: CreateSaleItemInput[];

  @Field(() => Float)
  subtotal: number;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  discountAmount?: number;

  @Field(() => Float, { nullable: true, defaultValue: 0 })
  taxAmount?: number;

  @Field(() => Float)
  total: number;

  @Field({ nullable: true, defaultValue: 'PENDING' })
  paymentStatus?: string;

  @Field({ nullable: true })
  paymentMethod?: string;
}

// Aliases for resolver (without barbershopId in input)
export const CreateServiceInput = CreateBarbershopServiceInput;
export const UpdateServiceInput = UpdateBarbershopServiceInput;
export const CreateProductInput = CreateBarbershopProductInput;
export const UpdateProductInput = UpdateBarbershopProductInput;
export const CreateWalkInServiceInput = WalkInServiceInput;
