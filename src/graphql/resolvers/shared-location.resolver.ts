import { Resolver, Query, Mutation, Args, Int, Float } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { SharedLocationService } from '../../barbershop/shared-location.service';
import { ChairRentService, RentBillingMode } from '../../barbershop/chair-rent.service';
import {
  AuthorizeChairRentResultType,
  ChairRentPaymentType,
  ChairRentReceiptType,
  ChairRentType,
  SharedLocationLinkType,
  SharedLocationOverviewType,
} from '../types/public-booking.type';

/** Espaço compartilhado (cadeira alugada), do lado do espaço e do profissional */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class SharedLocationResolver {
  constructor(
    private readonly sharedLocationService: SharedLocationService,
    private readonly chairRent: ChairRentService,
  ) {}

  @Query(() => SharedLocationOverviewType)
  async sharedLocation(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.list(user.id, barbershopId);
  }

  /** O espaço convida o negócio do profissional pelo link (ou slug) da página dele */
  @Mutation(() => SharedLocationLinkType)
  async inviteToSharedLocation(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('memberPageLink') memberPageLink: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.invite(user.id, barbershopId, memberPageLink);
  }

  @Mutation(() => SharedLocationLinkType)
  async respondSharedLocationInvite(
    @Args('id', { type: () => Int }) id: number,
    @Args('accept') accept: boolean,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.respond(user.id, id, accept);
  }

  /** Encerra o vínculo, de qualquer um dos lados (barbershopId = quem encerra) */
  @Mutation(() => Boolean)
  async endSharedLocation(
    @Args('id', { type: () => Int }) id: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.sharedLocationService.end(user.id, id, barbershopId);
  }

  // ---- Aluguel da cadeira ----

  /** O espaço define ou muda o aluguel mensal; sem valor (ou 0) encerra a cobrança */
  @Mutation(() => ChairRentType)
  async setChairRent(
    @Args('id', { type: () => Int }) id: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('amount', { type: () => Float, nullable: true }) amount: number | null,
    @CurrentUser() user: UserDTO,
    /** CARD (cartão pelo Stripe) ou MANUAL (PIX, dinheiro, transferência direto ao espaço) */
    @Args('mode', { nullable: true }) mode?: string,
  ) {
    return this.chairRent.setRent(
      user.id,
      id,
      barbershopId,
      amount ?? null,
      (mode as RentBillingMode) ?? null,
    );
  }

  /** O espaço registra o aluguel recebido direto (CASH, PIX, TRANSFER, OTHER) */
  @Mutation(() => ChairRentPaymentType)
  async recordChairRentPayment(
    @Args('paymentId', { type: () => Int }) paymentId: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('method') method: string,
    @CurrentUser() user: UserDTO,
    @Args('notes', { nullable: true }) notes?: string,
  ) {
    return this.chairRent.recordPayment(user.id, paymentId, barbershopId, method, notes);
  }

  /** Desfaz um pagamento registrado à mão por engano */
  @Mutation(() => ChairRentPaymentType)
  async undoChairRentPayment(
    @Args('paymentId', { type: () => Int }) paymentId: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chairRent.undoPayment(user.id, paymentId, barbershopId);
  }

  @Query(() => ChairRentReceiptType)
  async chairRentReceipt(
    @Args('paymentId', { type: () => Int }) paymentId: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chairRent.receipt(user.id, paymentId, barbershopId);
  }

  /** O profissional autoriza a cobrança mensal com um cartão salvo (ou troca o cartão recusado) */
  @Mutation(() => AuthorizeChairRentResultType)
  async authorizeChairRent(
    @Args('id', { type: () => Int }) id: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('paymentMethodId') paymentMethodId: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chairRent.authorize(user.id, id, barbershopId, paymentMethodId);
  }

  /** Recibos do aluguel, pros dois lados */
  @Query(() => [ChairRentPaymentType])
  async chairRentPayments(
    @Args('id', { type: () => Int }) id: number,
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.chairRent.payments(user.id, id, barbershopId);
  }
}
