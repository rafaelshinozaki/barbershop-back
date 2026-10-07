import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { BadRequestException, UseFilters, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { BackofficeArea, RequireArea } from '../../auth/backoffice-areas';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { UserService } from '../../auth/users/users.service';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { SendEmailNotificationInput } from '../dto/backoffice.dto';
import { staffActor } from '../../backoffice/actor';
import {
  ApprovalService,
  MASS_EMAIL_LIMIT,
  refundApprovalLimit,
} from '../../backoffice/approval.service';
import {
  PRIVACY_CHANNELS,
  PRIVACY_KINDS,
  PRIVACY_STATUSES,
  PrivacyRequestService,
} from '../../backoffice/privacy-request.service';
import { AccountDeletionService } from '../../barbershop/account-deletion.service';
import { AppPaymentsService } from '../../barbershop/app-payments.service';
import { BackofficeService } from '../../backoffice/backoffice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundAppPaymentInput } from './backoffice-ops.resolver';

const withJsonPayload = <T extends { payload: unknown }>(row: T) => ({
  ...row,
  payload: JSON.stringify(row.payload ?? {}),
});

/** Feito na hora (done) ou virou pedido de confirmação (approvalId) */
@ObjectType()
export class ApprovalOutcomeType {
  @Field() done: boolean;
  @Field(() => Int, { nullable: true }) approvalId?: number | null;
}

@ObjectType()
export class BackofficeApprovalType {
  @Field(() => Int) id: number;
  @Field() createdAt: Date;
  /** user.delete | payment.refund | email.mass */
  @Field() action: string;
  /** Os dados da ação, em JSON */
  @Field() payload: string;
  @Field() summary: string;
  @Field() reason: string;
  /** pending | executing | executed | rejected | failed */
  @Field() status: string;
  @Field() requestedByEmail: string;
  @Field() requestedByRole: string;
  @Field(() => String, { nullable: true }) decidedByEmail?: string | null;
  @Field(() => Date, { nullable: true }) decidedAt?: Date | null;
  @Field(() => String, { nullable: true }) decisionNote?: string | null;
  @Field(() => String, { nullable: true }) error?: string | null;
}

@ObjectType()
export class PrivacyRequestType {
  @Field(() => Int) id: number;
  @Field() createdAt: Date;
  @Field() kind: string;
  @Field() channel: string;
  @Field() requesterName: string;
  @Field() requesterEmail: string;
  @Field(() => Int, { nullable: true }) userId?: number | null;
  @Field(() => Int, { nullable: true }) clientAccountId?: number | null;
  @Field(() => Int, { nullable: true }) supportTicketId?: number | null;
  @Field() details: string;
  @Field() status: string;
  @Field() dueAt: Date;
  @Field(() => String, { nullable: true }) response?: string | null;
  @Field(() => Date, { nullable: true }) resolvedAt?: Date | null;
  @Field() createdByEmail: string;
  @Field(() => String, { nullable: true }) resolvedByEmail?: string | null;
}

@InputType()
export class CreatePrivacyRequestInput {
  @Field()
  @IsIn(PRIVACY_KINDS)
  kind: string;

  @Field()
  @IsIn(PRIVACY_CHANNELS)
  channel: string;

  @Field()
  @IsString()
  @MaxLength(200)
  requesterName: string;

  @Field()
  @IsString()
  @MaxLength(254)
  requesterEmail: string;

  @Field()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  details: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  supportTicketId?: number | null;
}

@InputType()
export class UpdatePrivacyRequestInput {
  @Field(() => Int)
  @IsInt()
  id: number;

  @Field()
  @IsIn(PRIVACY_STATUSES)
  status: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  response?: string | null;
}

/**
 * Fase 3 do backoffice (governança): ação sem volta com a confirmação de um
 * Administrador (apagar conta, estorno acima do limite, e-mail para mais de
 * 1.000 pessoas) e os pedidos do titular (LGPD).
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class BackofficeGovernanceResolver {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly privacy: PrivacyRequestService,
    private readonly users: UserService,
    private readonly accounts: AccountDeletionService,
    private readonly payments: AppPaymentsService,
    private readonly backoffice: BackofficeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Apagar a conta (dados pessoais apagados, como na exclusão pelo titular).
   * Administrador apaga na hora; o resto da equipe pede confirmação.
   */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS)
  @Mutation(() => ApprovalOutcomeType)
  async adminDeleteUser(
    @Args('userId', { type: () => Int }) userId: number,
    @Args('reason') reason: string,
    @CurrentUser() user: UserDTO,
  ) {
    await this.users.assertCanManageUsers(user, [userId]);
    const actor = staffActor(user);
    if (!reason || reason.trim().length < 5) throw new BadRequestException('Informe o motivo');
    if (actor.admin) {
      await this.accounts.deleteByStaff(userId);
      return { done: true, approvalId: null };
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      select: { email: true },
    });
    return this.approvals.request(
      'user.delete',
      { userId },
      `Apagar a conta #${userId}${target ? ` (${target.email})` : ''}`,
      reason,
      actor,
    );
  }

  /**
   * Antiga (o app do backoffice de antes da S2): só o Administrador, e pela
   * mesma exclusão do titular (antes apagava a linha direto). Sai na S4.
   */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => Boolean, { deprecationReason: 'Use adminDeleteUser' })
  async removeUser(
    @Args('userId', { type: () => Int }) userId: number,
    @CurrentUser() user: UserDTO,
  ) {
    await this.users.assertCanManageUsers(user, [userId]);
    await this.accounts.deleteByStaff(userId);
    return true;
  }

  /**
   * Antiga (o app do backoffice de antes da S2): manda na hora; para mais de
   * 1.000 pessoas, quem não é Administrador usa sendBackofficeEmail (pede
   * confirmação). Sai na S4.
   */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.OPERATIONS)
  @Mutation(() => Boolean, { deprecationReason: 'Use sendBackofficeEmail' })
  async sendEmailNotification(
    @Args('input') input: SendEmailNotificationInput,
    @CurrentUser() user: UserDTO,
  ) {
    const actor = staffActor(user);
    const reserved = actor.admin
      ? null
      : await this.approvals.reserveDirectEmail(actor, input.userIds.length);
    if (!actor.admin && reserved == null) {
      throw new BadRequestException(
        `Para mais de ${MASS_EMAIL_LIMIT} pessoas em 24 h, peça a confirmação de um Administrador`,
      );
    }
    await this.sendDirect(input, reserved);
    return true;
  }

  /**
   * E-mail para usuários; para mais de 1.000 pessoas (somando as últimas
   * 24 h), quem não é Administrador pede confirmação
   */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.OPERATIONS)
  @Mutation(() => ApprovalOutcomeType)
  async sendBackofficeEmail(
    @Args('input') input: SendEmailNotificationInput,
    @CurrentUser() user: UserDTO,
  ) {
    const actor = staffActor(user);
    const reserved = actor.admin
      ? null
      : await this.approvals.reserveDirectEmail(actor, input.userIds.length);
    if (!actor.admin && reserved == null) {
      return this.approvals.request(
        'email.mass',
        { ...input },
        `E-mail "${input.subject}" para ${input.userIds.length} pessoas`,
        `Envio em massa: ${input.subject}`,
        actor,
      );
    }
    await this.sendDirect(input, reserved);
    return { done: true, approvalId: null };
  }

  /** Manda na hora; se der erro, o envio anotado sai do limite de 24 h */
  private async sendDirect(input: SendEmailNotificationInput, reserved: number | null) {
    try {
      await this.backoffice.sendEmailNotification(input);
    } catch (err) {
      if (reserved != null) await this.approvals.releaseDirectEmail(reserved);
      throw err;
    }
  }

  /** Estorno pelo Financeiro; acima do limite, quem não é Administrador pede confirmação */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.FINANCE)
  @Mutation(() => ApprovalOutcomeType)
  async adminRefundAppPayment(
    @Args('input') input: RefundAppPaymentInput,
    @CurrentUser() user: UserDTO,
  ) {
    const actor = staffActor(user);
    const value = await this.payments.refundValue(input.kind, input.id, input.amount);
    const total = value + (await this.payments.refundedSoFar(input.kind, input.id));
    if (!actor.admin && total > refundApprovalLimit()) {
      return this.approvals.request(
        'payment.refund',
        { kind: input.kind, id: input.id, amount: input.amount ?? null, reason: input.reason },
        `Estornar ${value.toFixed(2)} (${input.kind} #${input.id})`,
        input.reason,
        actor,
      );
    }
    await this.payments.refund(input.kind, input.id, input.amount, input.reason);
    return { done: true, approvalId: null };
  }

  /** Pedidos de confirmação: o Administrador vê todos; o resto, os seus */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.USERS, BackofficeArea.FINANCE, BackofficeArea.OPERATIONS)
  @Query(() => [BackofficeApprovalType])
  async backofficeApprovals(
    @Args('status', { type: () => String, nullable: true }) status: string | null,
    @CurrentUser() user: UserDTO,
  ) {
    const rows = await this.approvals.list(staffActor(user), status);
    return rows.map(withJsonPayload);
  }

  /** Quantos esperam um Administrador (o selo no menu) */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Query(() => Int)
  backofficeApprovalsPending(@CurrentUser() user: UserDTO) {
    return this.approvals.pendingCount(staffActor(user));
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN)
  @Mutation(() => BackofficeApprovalType)
  async decideBackofficeApproval(
    @Args('id', { type: () => Int }) id: number,
    @Args('approve') approve: boolean,
    @Args('note', { type: () => String, nullable: true }) note: string | null,
    @CurrentUser() user: UserDTO,
  ) {
    return withJsonPayload(await this.approvals.decide(id, approve, note, staffActor(user)));
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Query(() => [PrivacyRequestType])
  privacyRequests(
    @Args('status', { type: () => String, nullable: true }) status?: string | null,
    @Args('overdue', { type: () => Boolean, nullable: true }) overdue?: boolean | null,
  ) {
    return this.privacy.list({ status, overdue });
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Mutation(() => PrivacyRequestType)
  createPrivacyRequest(
    @Args('input') input: CreatePrivacyRequestInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.privacy.create(input, staffActor(user));
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Mutation(() => PrivacyRequestType)
  updatePrivacyRequest(
    @Args('input') input: UpdatePrivacyRequestInput,
    @CurrentUser() user: UserDTO,
  ) {
    return this.privacy.update(input.id, input, staffActor(user));
  }
}
