import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { PayrollService } from '../../barbershop/payroll.service';
import {
  AddBarberPayEntryInput,
  BarberPayConfigType,
  BarberPayEntryType,
  BarberPayoutType,
  BarberPayStatementType,
  PayBarberInput,
  PayrollOverviewType,
  PayrollPreviewType,
  SetBarberPayConfigInput,
} from '../types/payroll.type';

/**
 * Pagamento da equipe: forma de pagamento, gorjetas/vales/bônus/descontos,
 * fechamento pago e relatórios. Dono e gerente mexem e veem todos; cada
 * profissional vê o próprio extrato.
 */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class PayrollResolver {
  constructor(private readonly payroll: PayrollService) {}

  @Mutation(() => BarberPayConfigType)
  async setBarberPayConfig(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: SetBarberPayConfigInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.setConfig(user.id, barbershopId, input.barberId, input);
  }

  @Mutation(() => BarberPayEntryType)
  async addBarberPayEntry(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: AddBarberPayEntryInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.addEntry(user.id, barbershopId, input);
  }

  @Mutation(() => Boolean)
  async deleteBarberPayEntry(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.deleteEntry(user.id, barbershopId, id);
  }

  /** Quanto o profissional tem a receber no período (antes de pagar) */
  @Query(() => PayrollPreviewType)
  async barberPayPreview(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('barberId', { type: () => Int }) barberId: number,
    @Args('from') from: string,
    @Args('to') to: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.preview(user.id, barbershopId, barberId, from, to);
  }

  /** Registra o pagamento do período (despesa "Salário"; dinheiro sai do caixa aberto) */
  @Mutation(() => BarberPayoutType)
  async payBarber(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: PayBarberInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.pay(user.id, barbershopId, input);
  }

  @Mutation(() => Boolean)
  async undoBarberPayout(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.undoPayout(user.id, barbershopId, id);
  }

  /** Extrato: sem barberId, o do próprio usuário */
  @Query(() => BarberPayStatementType)
  async barberPayStatement(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('barberId', { type: () => Int, nullable: true }) barberId?: number,
  ) {
    return this.payroll.statement(user.id, barbershopId, barberId ?? null);
  }

  @Query(() => PayrollOverviewType)
  async payrollOverview(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('from') from: string,
    @Args('to') to: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.payroll.overview(user.id, barbershopId, from, to);
  }
}
