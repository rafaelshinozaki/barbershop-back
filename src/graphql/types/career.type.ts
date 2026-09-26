import { Field, Float, GraphQLISODateTime, Int, ObjectType } from '@nestjs/graphql';
import { TreatmentCategory } from './enums';

@ObjectType()
export class CareerPlaceType {
  @Field(() => Int)
  barberId: number;

  @Field(() => Int)
  shopId: number;

  @Field()
  shopName: string;

  @Field(() => String, { nullable: true })
  staffType: string | null;

  @Field()
  active: boolean;

  @Field(() => GraphQLISODateTime)
  startedAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  endedAt: Date | null;

  @Field(() => Float, { nullable: true })
  commissionPercent: number | null;
}

@ObjectType()
export class CareerServiceCountType {
  @Field()
  name: string;

  @Field(() => Int)
  count: number;
}

@ObjectType()
export class CareerCurrencyType {
  @Field()
  currency: string;

  @Field(() => Float)
  revenue: number;

  @Field(() => Float)
  paid: number;

  @Field(() => Float)
  commission: number;

  @Field(() => Float)
  tips: number;
}

@ObjectType()
export class CareerOverviewType {
  @Field(() => [CareerPlaceType])
  places: CareerPlaceType[];

  @Field(() => Int)
  completedAppointments: number;

  @Field(() => Int)
  noShows: number;

  @Field(() => Int)
  uniqueClients: number;

  @Field(() => Int)
  returningClients: number;

  @Field(() => Int, { nullable: true })
  busiestHour: number | null;

  @Field(() => [CareerServiceCountType])
  topServices: CareerServiceCountType[];

  @Field(() => [CareerCurrencyType])
  byCurrency: CareerCurrencyType[];

  @Field(() => [CareerPastVisitType])
  pastVisits: CareerPastVisitType[];

  @Field(() => [CareerShopLinkType])
  ownedShops: CareerShopLinkType[];

  @Field(() => String, { nullable: true })
  slug: string | null;

  @Field()
  isPublic: boolean;

  @Field()
  visibility: string;
}

/** Atendimento antigo: primeiro nome e data. Sem contato. */
@ObjectType()
export class CareerPastVisitType {
  @Field()
  shopName: string;

  @Field(() => GraphQLISODateTime)
  occurredAt: Date;

  @Field()
  firstName: string;
}

@ObjectType()
export class CareerShopLinkType {
  @Field()
  name: string;

  @Field()
  slug: string;
}

@ObjectType()
export class PublicProfessionalType {
  @Field()
  fullName: string;

  @Field()
  visibility: string;

  @Field(() => String, { nullable: true })
  photoUrl: string | null;

  @Field(() => String, { nullable: true })
  phone: string | null;

  @Field(() => String, { nullable: true })
  email: string | null;

  @Field(() => Int, { nullable: true })
  completedAppointments: number | null;

  @Field(() => [CareerShopLinkType])
  worksAt: CareerShopLinkType[];

  @Field(() => [CareerShopLinkType])
  workedAt: CareerShopLinkType[];

  @Field(() => [CareerShopLinkType])
  owns: CareerShopLinkType[];
}

@ObjectType()
export class ProfileShiftType {
  @Field(() => Int)
  dayOfWeek: number;

  @Field()
  startTime: string;

  @Field()
  endTime: string;

  @Field()
  shopName: string;
}

@ObjectType()
export class ProfilePrivacyType {
  @Field()
  hasProfile: boolean;

  @Field()
  fullName: string;

  @Field(() => String, { nullable: true })
  phone: string | null;

  @Field()
  email: string;

  @Field(() => String, { nullable: true })
  photoUrl: string | null;

  @Field(() => Int)
  completedAppointments: number;

  @Field(() => [CareerShopLinkType])
  worksAt: CareerShopLinkType[];

  @Field(() => [CareerShopLinkType])
  workedAt: CareerShopLinkType[];

  @Field(() => [CareerShopLinkType])
  owns: CareerShopLinkType[];

  @Field(() => [ProfileShiftType])
  shifts: ProfileShiftType[];

  @Field()
  visibility: string;

  @Field(() => [String])
  roles: string[];

  @Field(() => [TreatmentCategory])
  specialties: TreatmentCategory[];

  @Field(() => [String])
  cities: string[];

  @Field()
  openToWork: boolean;

  @Field(() => [String])
  engagements: string[];

  @Field(() => [String])
  acceptedRoles: string[];

  @Field()
  acceptingClients: boolean;

  @Field()
  showPhoto: boolean;

  @Field()
  showRating: boolean;

  @Field()
  showAppointmentCount: boolean;

  @Field()
  showReviews: boolean;

  @Field()
  showWorkHistory: boolean;

  @Field()
  showLocations: boolean;

  @Field()
  showContact: boolean;
}
