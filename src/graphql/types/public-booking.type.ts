import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import { TreatmentCategory } from './enums';

@ObjectType()
export class PublicServiceType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  icon?: string;

  @Field(() => Int)
  durationMinutes: number;

  @Field(() => Float)
  price: number;

  @Field(() => TreatmentCategory)
  category: TreatmentCategory;

  @Field(() => Float, { nullable: true })
  depositAmount?: number;
}

@ObjectType()
export class PublicBarberType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  @Field({ nullable: true })
  specialization?: string;

  @Field(() => [TreatmentCategory])
  specialties: TreatmentCategory[];
}

@ObjectType()
export class PublicSubscriptionPlanType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field(() => Float)
  price: number;

  @Field(() => Int, { nullable: true })
  sessionsPerCycle?: number;

  @Field()
  serviceName: string;
}

@ObjectType()
export class PublicBarbershopType {
  @Field(() => Int)
  id: number;

  @Field({ nullable: true, description: 'Cor de destaque da franquia (Radix); null = padrão' })
  accentColor?: string;

  @Field({ nullable: true, description: 'Tom de cinza da franquia (Radix); null = padrão' })
  grayColor?: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  address: string;

  @Field({ nullable: true })
  complement1?: string;

  @Field({ nullable: true })
  complement2?: string;

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
  imageUrl?: string;

  @Field()
  timezone: string;

  @Field()
  currency: string;

  @Field(() => [PublicServiceType])
  services: PublicServiceType[];

  @Field(() => [PublicBarberType])
  barbers: PublicBarberType[];

  @Field(() => [PublicSubscriptionPlanType])
  subscriptionPlans: PublicSubscriptionPlanType[];

  @Field(() => Float, { nullable: true })
  averageRating?: number;

  @Field(() => Int)
  reviewCount: number;

  @Field()
  isFeatured: boolean;
}

@ObjectType()
export class PublicBarbershopSearchResultType {
  @Field(() => Int)
  id: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  city: string;

  @Field()
  state: string;

  @Field()
  address: string;

  @Field({ nullable: true })
  imageUrl?: string;

  @Field()
  networkName: string;

  @Field(() => [TreatmentCategory])
  categories: TreatmentCategory[];

  @Field(() => Float, { nullable: true })
  distanceKm?: number;

  @Field(() => Float, { nullable: true })
  averageRating?: number;

  @Field(() => Int)
  reviewCount: number;

  @Field()
  isFeatured: boolean;
}

@ObjectType()
export class ReviewType {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string;

  @Field()
  createdAt: string;

  @Field()
  reviewerName: string;
}

@ObjectType()
export class MyReviewType {
  @Field(() => Int)
  rating: number;

  @Field({ nullable: true })
  comment?: string;
}

@ObjectType()
export class PublicAppointmentType {
  @Field(() => Int)
  id: number;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field()
  status: string;

  @Field()
  barbershopName: string;

  @Field()
  barberName: string;

  @Field()
  serviceName: string;

  @Field(() => Float)
  price: number;

  @Field()
  currency: string;

  @Field(() => Float, { nullable: true })
  depositAmount?: number;
}
