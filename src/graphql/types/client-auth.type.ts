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
