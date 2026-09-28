import { Args, Field, Float, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters } from '@nestjs/common';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleSlotSearch } from '../../common/decorators/throttle.decorator';
import { PrepaymentService } from '../../barbershop/prepayment.service';

@ObjectType()
export class AppointmentPrepaymentType {
  @Field({ description: 'Dá pra pagar agora pelo app (unidade recebe pelo app)' })
  available: boolean;

  @Field(() => Float, { description: 'Preço dos serviços menos o sinal já pago' })
  amount: number;

  @Field()
  currency: string;

  @Field()
  paid: boolean;

  @Field(() => Float, { nullable: true })
  paidAmount: number | null;

  @Field()
  refunded: boolean;
}

@ObjectType()
export class PrepaymentStartType {
  @Field()
  clientSecret: string;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;
}

/**
 * Pagar o atendimento pelo app, pelo link "gerenciar agendamento" (sem
 * login): direto na conta de recebimento da unidade (Stripe Connect).
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class PrepaymentResolver {
  constructor(private readonly prepayments: PrepaymentService) {}

  @Query(() => AppointmentPrepaymentType)
  appointmentPrepayment(@Args('token') token: string) {
    return this.prepayments.status(token);
  }

  @ThrottleSlotSearch()
  @Mutation(() => PrepaymentStartType)
  startAppointmentPrepayment(@Args('token') token: string) {
    return this.prepayments.start(token);
  }

  /** A tela voltou do cartão: confere no Stripe e registra (o webhook também) */
  @ThrottleSlotSearch()
  @Mutation(() => AppointmentPrepaymentType)
  async confirmAppointmentPrepayment(@Args('token') token: string) {
    await this.prepayments.confirm(token);
    return this.prepayments.status(token);
  }
}
