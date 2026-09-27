import { Args, Field, Float, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { TipService } from '../../barbershop/tip.service';

/** Caixinha registrada num atendimento */
@ObjectType()
export class AppointmentTipType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field({ description: 'professional | unit' })
  destination: string;

  @Field({ description: 'CASH | PIX | CARD' })
  method: string;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;

  @Field({ description: 'A unidade recebeu e repassa ao profissional no pagamento' })
  receivedByUnit: boolean;

  @Field(() => String, { nullable: true })
  barberName: string | null;

  @Field({ description: 'Já entrou num pagamento do profissional (não dá mais pra apagar)' })
  paidOut: boolean;
}

/** Caixinha do atendimento, registrada na mão pela equipe (item 11 do roadmap) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class TipResolver {
  constructor(private readonly tips: TipService) {}

  @Query(() => [AppointmentTipType])
  appointmentTips(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.tips.list(user.id, barbershopId, appointmentId);
  }

  @Mutation(() => AppointmentTipType)
  addAppointmentTip(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('appointmentId', { type: () => Int }) appointmentId: number,
    @Args('destination') destination: string,
    @Args('method') method: string,
    @Args('amount', { type: () => Float }) amount: number,
    @CurrentUser() user: UserDTO,
    @Args('receivedByUnit', { type: () => Boolean, nullable: true }) receivedByUnit?: boolean,
  ) {
    return this.tips.add(user.id, barbershopId, appointmentId, {
      destination,
      method,
      amount,
      receivedByUnit,
    });
  }

  @Mutation(() => Boolean)
  removeAppointmentTip(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('tipId', { type: () => Int }) tipId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.tips.remove(user.id, barbershopId, tipId);
  }
}
