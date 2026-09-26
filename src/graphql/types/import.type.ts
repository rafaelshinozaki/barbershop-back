import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class ShopImportResultType {
  @Field(() => Int)
  customersCreated: number;

  @Field(() => Int)
  customersReused: number;

  @Field(() => Int)
  servicesCreated: number;

  @Field(() => Int)
  servicesReused: number;

  @Field(() => Int)
  appointmentsCreated: number;

  @Field(() => Int)
  appointmentsSkipped: number;

  @Field(() => [String])
  errors: string[];
}
