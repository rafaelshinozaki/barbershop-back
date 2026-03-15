import { ObjectType, Field, Int } from '@nestjs/graphql';

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
export class HealthStatus {
  @Field()
  status: string;

  @Field()
  database: string;

  @Field()
  stripe: string;

  @Field()
  timestamp: string;
}
