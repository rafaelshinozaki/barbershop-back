import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class CommonResponse {
  @Field(() => Int)
  count: number;
}
