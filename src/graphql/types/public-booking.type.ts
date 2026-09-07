import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

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

  @Field()
  category: string;
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

  @Field(() => [String])
  specialties: string[];
}

@ObjectType()
export class PublicBarbershopType {
  @Field(() => Int)
  id: number;

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
}
