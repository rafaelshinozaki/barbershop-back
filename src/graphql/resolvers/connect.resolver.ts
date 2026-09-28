import { Args, Field, Float, Int, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleAuth } from '../../common/decorators/throttle.decorator';
import { ConnectService } from '../../barbershop/connect.service';

@ObjectType()
export class PaymentAccountStatusType {
  @Field({ description: 'Já começou o cadastro da conta de recebimento' })
  connected: boolean;

  @Field({ description: 'Pode receber: o que passa pelo app cai direto nesta conta' })
  chargesEnabled: boolean;

  @Field({ description: 'O Stripe já transfere pro banco' })
  payoutsEnabled: boolean;

  @Field()
  detailsSubmitted: boolean;

  @Field(() => String, { nullable: true, description: 'Pendência apontada pelo Stripe' })
  disabledReason: string | null;

  @Field(() => Float, { description: 'Taxa da plataforma sobre o que passa pelo Stripe (%)' })
  feePercentage: number;
}

@ObjectType()
export class PaymentAccountLinkType {
  @Field({ description: 'Página do Stripe (cadastro ou painel)' })
  url: string;
}

/** "Receber pelo app" da unidade (Stripe Connect Express, opcional) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ConnectResolver {
  constructor(private readonly connect: ConnectService) {}

  @Query(() => PaymentAccountStatusType)
  barbershopPaymentAccount(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.connect.barbershopStatus(user.id, barbershopId);
  }

  /** Abre ou continua o cadastro na página do Stripe (só o dono) */
  @ThrottleAuth()
  @Mutation(() => PaymentAccountLinkType)
  startBarbershopPaymentAccount(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.connect.startBarbershopOnboarding(user.id, barbershopId);
  }

  /** Voltou da página do Stripe: atualiza a situação sem esperar o webhook */
  @Mutation(() => PaymentAccountStatusType)
  refreshBarbershopPaymentAccount(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.connect.refreshBarbershop(user.id, barbershopId);
  }

  /** Painel do Stripe da conta: extrato, repasses e dados bancários (só o dono) */
  @Mutation(() => PaymentAccountLinkType)
  barbershopPaymentDashboardLink(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.connect.barbershopDashboardLink(user.id, barbershopId);
  }

  // ---- profissional: caixinha pelo app ----

  @Query(() => PaymentAccountStatusType)
  myPaymentAccount(@CurrentUser() user: UserDTO) {
    return this.connect.professionalStatus(user.id);
  }

  @ThrottleAuth()
  @Mutation(() => PaymentAccountLinkType)
  startMyPaymentAccount(@CurrentUser() user: UserDTO) {
    return this.connect.startProfessionalOnboarding(user.id);
  }

  @Mutation(() => PaymentAccountStatusType)
  refreshMyPaymentAccount(@CurrentUser() user: UserDTO) {
    return this.connect.refreshProfessional(user.id);
  }

  @Mutation(() => PaymentAccountLinkType)
  myPaymentDashboardLink(@CurrentUser() user: UserDTO) {
    return this.connect.professionalDashboardLink(user.id);
  }

  /** Só fora de produção, com o fornecedor falso (desenvolvimento e E2E) */
  @Mutation(() => Boolean)
  completeFakePaymentAccount(@Args('accountId') accountId: string, @CurrentUser() user: UserDTO) {
    return this.connect.completeFake(user.id, accountId);
  }
}
