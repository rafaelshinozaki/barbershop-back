import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Algo mudou numa barbearia — o dashboard recarrega os dados' })
export class NetworkActivityEvent {
  @Field(() => Int)
  networkId: number;

  @Field(() => Int)
  barbershopId: number;

  @Field({ description: 'APPOINTMENT | SALE | WALK_IN | CUSTOMER' })
  kind: string;

  @Field({ description: 'CREATED | UPDATED | DELETED' })
  action: string;

  @Field()
  at: string;
}
