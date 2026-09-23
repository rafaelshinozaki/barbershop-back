import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Algo mudou numa barbearia — o dashboard recarrega os dados' })
export class NetworkActivityEvent {
  @Field(() => Int)
  networkId: number;

  @Field(() => Int)
  barbershopId: number;

  @Field({ description: 'APPOINTMENT | SALE | WALK_IN | CUSTOMER | BARBER' })
  kind: string;

  @Field({ description: 'CREATED | UPDATED | DELETED' })
  action: string;

  @Field()
  at: string;
}

@ObjectType({ description: 'Mudança no sininho do usuário — a tela recarrega lista e contagem' })
export class NotificationEvent {
  @Field({ description: 'CREATED | READ | DELETED' })
  action: string;

  @Field({ nullable: true, description: 'Título da notificação nova (só em CREATED)' })
  title?: string;
}
