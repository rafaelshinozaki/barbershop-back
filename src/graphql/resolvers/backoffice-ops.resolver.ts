import {
  Args,
  Field,
  Float,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeArea, hasBackofficeArea, RequireArea } from '../../auth/backoffice-areas';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { UserService } from '../../auth/users/users.service';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { UserDossierService } from '../../backoffice/user-dossier.service';
import { BackofficeSearchService } from '../../backoffice/backoffice-search.service';
import {
  APP_PAYMENT_KINDS,
  APP_PAYMENT_STATUSES,
  AppPaymentsService,
  type AppPaymentKind,
  type AppPaymentStatus,
} from '../../barbershop/app-payments.service';

const can = (actor: UserDTO | undefined, area: BackofficeArea) =>
  hasBackofficeArea(actor?.role?.name, actor?.backofficeAreas, area);

// ---- Ficha da pessoa ----

@ObjectType()
export class UserDossierUnitType {
  @Field(() => Int) id: number;
  @Field() name: string;
  @Field() city: string;
  @Field() isActive: boolean;
  /** owner | team */
  @Field() relation: string;
  @Field(() => String, { nullable: true }) staffType?: string | null;
  /** Vínculo temporário: até quando */
  @Field(() => Date, { nullable: true }) accessEndsAt?: Date | null;
}

@ObjectType()
export class UserDossierSessionType {
  @Field(() => Int) id: number;
  @Field() deviceType: string;
  @Field() browser: string;
  @Field() os: string;
  @Field() location: string;
  @Field() createdAt: Date;
}

@ObjectType()
export class UserDossierTicketType {
  @Field(() => Int) id: number;
  @Field() subject: string;
  @Field() status: string;
  @Field() category: string;
  @Field() lastActivityAt: Date;
}

@ObjectType()
export class UserDossierPaymentType {
  @Field(() => Int) id: number;
  @Field(() => Float) amount: number;
  @Field() status: string;
  @Field() paymentDate: Date;
}

@ObjectType()
export class UserDossierFinanceType {
  @Field() membership: string;
  @Field(() => Date, { nullable: true }) proUntil?: Date | null;
  @Field(() => String, { nullable: true }) planName?: string | null;
  @Field(() => String, { nullable: true }) subscriptionStatus?: string | null;
  @Field(() => Date, { nullable: true }) currentPeriodEnd?: Date | null;
  @Field(() => [UserDossierPaymentType]) payments: UserDossierPaymentType[];
}

@ObjectType()
export class UserDossierType {
  @Field(() => Int) id: number;
  @Field() fullName: string;
  @Field() email: string;
  @Field() phone: string;
  @Field() role: string;
  @Field() isActive: boolean;
  @Field() createdAt: Date;
  @Field() twoFactorEnabled: boolean;
  @Field() provider: string;
  @Field(() => [UserDossierUnitType]) units: UserDossierUnitType[];
  @Field(() => [UserDossierSessionType]) sessions: UserDossierSessionType[];
  @Field(() => [UserDossierSessionType]) logins: UserDossierSessionType[];
  @Field(() => [UserDossierTicketType]) supportTickets: UserDossierTicketType[];
  /** Área do cliente ligada à conta (mesmo e-mail e senha) */
  @Field(() => Int, { nullable: true }) clientAccountId?: number | null;
  @Field() clientSuspended: boolean;
  /** Só para quem tem o Financeiro */
  @Field(() => UserDossierFinanceType, { nullable: true }) finance?: UserDossierFinanceType | null;
}

// ---- Busca ----

@ObjectType()
export class BackofficeSearchHitType {
  /** user | barbershop | client */
  @Field() kind: string;
  @Field(() => Int) id: number;
  @Field() title: string;
  @Field(() => String, { nullable: true }) subtitle?: string | null;
}

// ---- Pagamentos pelo app ----

@InputType()
export class AppPaymentFilterInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(APP_PAYMENT_KINDS)
  kind?: AppPaymentKind | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(APP_PAYMENT_STATUSES)
  status?: AppPaymentStatus | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  barbershopId?: number | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  from?: Date | null;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  to?: Date | null;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

@ObjectType()
export class AppPaymentType {
  /** deposit | prepaid | tip */
  @Field() kind: string;
  @Field(() => Int) id: number;
  @Field(() => Int) appointmentId: number;
  @Field(() => Int) barbershopId: number;
  @Field() barbershopName: string;
  @Field() paidAt: Date;
  @Field(() => Float) amount: number;
  @Field(() => Float) refundedAmount: number;
  @Field() currency: string;
  /** paid | partial | refunded | disputed */
  @Field() status: string;
  @Field(() => String, { nullable: true }) disputeStatus?: string | null;
  @Field(() => String, { nullable: true }) disputeReason?: string | null;
}

@ObjectType()
export class AppPaymentPageType {
  @Field(() => Int) total: number;
  @Field(() => Float) amount: number;
  @Field(() => Float) refunded: number;
  /** Taxa da plataforma pela tabela de hoje, sobre o que não foi devolvido */
  @Field(() => Float) estimatedFee: number;
  @Field(() => Float) feePercent: number;
  @Field(() => [AppPaymentType]) items: AppPaymentType[];
}

@InputType()
export class RefundAppPaymentInput {
  @Field()
  @IsIn(APP_PAYMENT_KINDS)
  kind: AppPaymentKind;

  @Field(() => Int)
  @IsInt()
  id: number;

  /** Só no atendimento pago (estorno parcial); vazio = o que restar */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @Min(0.01)
  amount?: number | null;

  @Field()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

/**
 * Fase 2 do backoffice: ver uma pessoa inteira, a busca do topo, derrubar
 * sessões e os pagamentos pelo app (com estorno).
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class BackofficeOpsResolver {
  constructor(
    private readonly dossier: UserDossierService,
    private readonly searchService: BackofficeSearchService,
    private readonly users: UserService,
    private readonly payments: AppPaymentsService,
  ) {}

  /** Ficha da pessoa (só leitura); plano e cobranças só com o Financeiro */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS)
  @Query(() => UserDossierType)
  adminUserDossier(
    @Args('userId', { type: () => Int }) userId: number,
    @CurrentUser() actor: UserDTO,
  ) {
    return this.dossier.detail(userId, { finance: can(actor, BackofficeArea.FINANCE) });
  }

  /**
   * Busca do topo: contas e unidades pra quem tem Usuários, contas de
   * cliente pra quem tem Suporte (com qualquer uma das duas, entra)
   */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS, BackofficeArea.SUPPORT)
  @Query(() => [BackofficeSearchHitType])
  backofficeSearch(@Args('text') text: string, @CurrentUser() actor: UserDTO) {
    return this.searchService.search(text, {
      users: can(actor, BackofficeArea.USERS),
      clients: can(actor, BackofficeArea.SUPPORT),
    });
  }

  /** Derruba todas as sessões da conta (app e área do cliente ligada) */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS)
  @Mutation(() => Int)
  async adminRevokeUserSessions(
    @Args('userId', { type: () => Int }) userId: number,
    @CurrentUser() actor: UserDTO,
  ) {
    await this.users.assertCanManageUsers(actor, [userId]);
    return this.users.revokeAllSessions(userId);
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.FINANCE)
  @Query(() => AppPaymentPageType)
  adminAppPayments(
    @Args('filter', { type: () => AppPaymentFilterInput, nullable: true })
    filter?: AppPaymentFilterInput,
  ) {
    return this.payments.list(filter ?? {});
  }

  // Estorno: adminRefundAppPayment em backoffice-governance.resolver (acima do
  // limite, quem não é Administrador pede confirmação)
}
