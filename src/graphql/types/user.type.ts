import { ObjectType, Field, Int } from '@nestjs/graphql';
import { EmailNotification } from './notification.type';
import { UserRole, MembershipStatus } from './enums';

@ObjectType()
export class UserSystemConfig {
  @Field(() => Int)
  id: number;

  @Field()
  theme: string;

  @Field()
  accentColor: string;

  @Field()
  grayColor: string;

  @Field()
  radius: string;

  @Field()
  scaling: string;

  @Field()
  language: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class Address {
  @Field(() => Int)
  id: number;

  @Field()
  zipcode: string;

  @Field()
  street: string;

  @Field()
  city: string;

  @Field()
  neighborhood: string;

  @Field()
  state: string;

  @Field()
  country: string;

  @Field({ nullable: true })
  complement1?: string;

  @Field({ nullable: true })
  complement2?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;
}

@ObjectType()
export class User {
  @Field(() => Int)
  id: number;

  @Field()
  email: string;

  @Field()
  provider: string;

  @Field()
  fullName: string;

  @Field()
  idDocNumber: string;

  @Field()
  phone: string;

  @Field()
  gender: string;

  @Field()
  birthdate: string;

  @Field()
  company: string;

  @Field({ nullable: true })
  jobTitle?: string;

  @Field({ nullable: true })
  department?: string;

  @Field()
  professionalSegment: string;

  @Field()
  knowledgeApp: string;

  @Field()
  readTerms: boolean;

  @Field(() => MembershipStatus, { nullable: true })
  membership?: MembershipStatus;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  stripeCustomerId?: string;

  @Field(() => String, { nullable: true })
  role?: string;

  @Field()
  twoFactorEnabled: boolean;

  @Field({ nullable: true })
  photoKey?: string;

  @Field()
  createdAt: string;

  @Field()
  updatedAt: string;

  @Field({ nullable: true })
  deleted_at?: string;

  @Field(() => EmailNotification, { nullable: true })
  emailNotification?: EmailNotification;

  @Field(() => UserSystemConfig, { nullable: true })
  userSystemConfig?: UserSystemConfig;

  @Field(() => Address, { nullable: true })
  address?: Address;

  @Field({ nullable: true })
  twoFactorRequired?: boolean;

  @Field({ nullable: true })
  loginId?: string;

  @Field({ nullable: true })
  plan?: string;

  @Field({ nullable: true })
  subscriptionStatus?: string;
}
