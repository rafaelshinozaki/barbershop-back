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

/** Outra barbearia no espaço compartilhado (só o que é público) */
@ObjectType()
export class SharedLocationShopType {
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
}

@ObjectType()
export class SharedLocationLinkType {
  @Field(() => Int)
  id: number;

  /** PENDING | ACTIVE */
  @Field()
  status: string;

  @Field()
  createdAt: Date;

  /** A barbearia do outro lado */
  @Field(() => SharedLocationShopType)
  shop: SharedLocationShopType;
}

@ObjectType()
export class SharedLocationOverviewType {
  /** Profissionais independentes que atendem no espaço desta unidade */
  @Field(() => [SharedLocationLinkType])
  asHost: SharedLocationLinkType[];

  /** Espaços onde esta unidade atende como profissional independente */
  @Field(() => [SharedLocationLinkType])
  asMember: SharedLocationLinkType[];
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

  /** Espaço compartilhado: profissionais independentes que atendem aqui */
  @Field(() => [SharedLocationShopType], { defaultValue: [] })
  sharedLocationMembers: SharedLocationShopType[];

  /** Espaços onde este profissional independente atende */
  @Field(() => [SharedLocationShopType], { defaultValue: [] })
  sharedLocationHosts: SharedLocationShopType[];
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

  @Field({ description: 'Token do link "gerenciar agendamento" (o mesmo do e-mail)' })
  manageToken: string;
}

/** Agendamento aberto pelo link do e-mail (cliente cancela/remarca sem login). */
@ObjectType()
export class ManagedAppointmentType {
  @Field(() => Int)
  id: number;

  @Field()
  status: string;

  @Field()
  startAt: string;

  @Field()
  endAt: string;

  @Field({ description: 'Ainda dá pra cancelar/remarcar pelo link' })
  canChange: boolean;

  @Field({ description: 'Até quando dá pra mudar pelo link (política de cancelamento)' })
  changeDeadline: string;

  @Field(() => Int)
  cancellationWindowHours: number;

  @Field()
  customerName: string;

  @Field(() => Int)
  barbershopId: number;

  @Field()
  barbershopName: string;

  @Field()
  barbershopSlug: string;

  @Field({ nullable: true })
  barbershopPhone?: string;

  @Field()
  barbershopAddress: string;

  @Field({ nullable: true })
  timezone?: string;

  @Field(() => Int)
  barberId: number;

  @Field()
  barberName: string;

  @Field(() => Int, { nullable: true })
  serviceId?: number | null;

  @Field()
  serviceName: string;

  @Field(() => Float)
  price: number;

  @Field()
  currency: string;
}
