import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { DepositPaymentService, stripeConfigured } from '../../barbershop/deposit-payment.service';
import { SubscriptionRevenueReportType } from '../types/barbershop.type';

/** Sinal pago online: ligar na unidade e ver o repasse */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class DepositResolver {
  constructor(private readonly deposits: DepositPaymentService) {}

  /** O servidor tem Stripe configurado (dá pra ligar o sinal online) */
  @Query(() => Boolean)
  onlinePaymentsAvailable() {
    return stripeConfigured();
  }

  @Mutation(() => Boolean)
  async setOnlineDeposit(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('enabled') enabled: boolean,
    @CurrentUser() user: UserDTO,
  ) {
    return this.deposits.setOnlineDeposit(user.id, barbershopId, enabled);
  }

  @Query(() => SubscriptionRevenueReportType)
  async depositPayoutReport(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('startDate', { nullable: true }) startDate?: string,
    @Args('endDate', { nullable: true }) endDate?: string,
  ) {
    return this.deposits.payoutReport(user.id, barbershopId, startDate, endDate);
  }
}
