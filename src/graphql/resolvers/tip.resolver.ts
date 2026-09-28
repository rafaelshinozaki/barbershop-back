import { Args, Field, Float, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { TipService } from '../../barbershop/tip.service';
import { ThrottlePublicBooking } from '../../common/decorators/throttle.decorator';

/** Caixinha registrada num atendimento */
@ObjectType()
export class AppointmentTipType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field({ description: 'professional | unit' })
  destination: string;

  @Field({ description: 'CASH | PIX | CARD | STRIPE (pelo app)' })
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

@ObjectType()
export class AppTipGivenType {
  @Field({ description: 'professional | unit' })
  destination: string;

  @Field(() => Float)
  amount: number;
}

@ObjectType()
export class AppTipOptionsType {
  @Field()
  currency: string;

  @Field()
  professionalName: string;

  @Field()
  barbershopName: string;

  @Field({ description: 'O profissional recebe caixinha pelo app (conta ativa)' })
  professional: boolean;

  @Field({ description: 'A unidade recebe caixinha pelo app (conta ativa)' })
  unit: boolean;

  @Field(() => Float)
  minAmount: number;

  @Field(() => Float)
  maxAmount: number;

  @Field(() => [AppTipGivenType], { description: 'Caixinhas que o cliente já deu pelo app' })
  given: AppTipGivenType[];
}

@ObjectType()
export class AppTipPaymentType {
  @Field()
  clientSecret: string;

  @Field()
  paymentIntentId: string;

  @Field(() => Float)
  amount: number;

  @Field()
  currency: string;
}

/**
 * Caixinha pelo app, pelo link "como foi?" do e-mail (sem login): cartão,
 * direto na conta de recebimento de quem recebe (Stripe Connect).
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class AppTipResolver {
  constructor(private readonly tips: TipService) {}

  @Query(() => AppTipOptionsType)
  appTipOptions(@Args('token') token: string) {
    return this.tips.appTipOptions(token);
  }

  @ThrottlePublicBooking()
  @Mutation(() => AppTipPaymentType)
  startAppTip(
    @Args('token') token: string,
    @Args('destination', { description: 'professional | unit' }) destination: string,
    @Args('amount', { type: () => Float }) amount: number,
  ) {
    return this.tips.startAppTip(token, destination, amount);
  }

  /** A tela voltou do cartão: registra a caixinha (o webhook também registra) */
  @Mutation(() => Boolean)
  confirmAppTip(@Args('token') token: string, @Args('paymentIntentId') paymentIntentId: string) {
    return this.tips.confirmAppTip(token, paymentIntentId);
  }
}
