import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class ClientAccountType {
  @Field(() => Int)
  id: number;

  @Field()
  email: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  phone?: string;

  @Field({ nullable: true })
  avatarUrl?: string;

  /** Sem e-mail confirmado o histórico das barbearias não aparece */
  @Field()
  emailVerified: boolean;

  /** false = conta só de login social (confirma a exclusão digitando o e-mail) */
  @Field()
  hasPassword: boolean;
}

@ObjectType()
export class ClientHistoryEntryType {
  @Field()
  id: string;

  @Field()
  type: string;

  @Field()
  date: string;

  @Field()
  networkName: string;

  @Field()
  barbershopName: string;

  @Field({ nullable: true })
  detail?: string;

  @Field()
  status: string;

  @Field(() => Float, { nullable: true })
  total?: number;

  @Field({ nullable: true })
  currency?: string;
}

@ObjectType()
export class ClientLinkedSocialAccountType {
  @Field()
  provider: string;

  @Field()
  providerEmail: string;

  @Field()
  createdAt: string;
}
