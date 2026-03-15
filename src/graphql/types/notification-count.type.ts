import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class NotificationCount {
  @Field(() => Int)
  unreadCount: number;

  @Field(() => Int)
  newCount: number;
}
