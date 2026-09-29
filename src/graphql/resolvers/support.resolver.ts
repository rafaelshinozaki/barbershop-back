import {
  Args,
  Context,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { Role } from '../../auth/interfaces/roles';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleEmail } from '../../common/decorators/throttle.decorator';
import { SupportService } from '../../support/support.service';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import { ClientSuspensionService } from '../../client-auth/client-suspension.service';
import { BackofficeArea, RequireArea } from '../../auth/backoffice-areas';

// Responder pelo link do e-mail: 20 por hora por IP/navegador
const ThrottleSupportReply = () => Throttle({ default: { limit: 20, ttl: 3600000 } });

@InputType()
export class ContactSupportInput {
  @Field()
  name: string;

  @Field()
  email: string;

  @Field({ description: 'account | booking | payment | safety | other' })
  category: string;

  @Field()
  subject: string;

  @Field()
  message: string;

  @Field({ nullable: true })
  language?: string;
}

@ObjectType()
export class SupportMessageType {
  @Field(() => Int)
  id: number;

  @Field()
  createdAt: Date;

  @Field({ description: 'requester (quem pediu) | support (plataforma)' })
  side: string;

  @Field()
  body: string;
}

@ObjectType()
export class SupportTicketCreatedType {
  @Field(() => Int)
  id: number;
}

@ObjectType()
export class SupportTicketPublicType {
  @Field(() => Int)
  id: number;

  @Field()
  subject: string;

  @Field()
  category: string;

  @Field({ description: 'open | answered | closed' })
  status: string;

  @Field()
  createdAt: Date;

  @Field(() => [SupportMessageType])
  messages: SupportMessageType[];
}

@ObjectType()
export class SupportTicketType extends SupportTicketPublicType {
  @Field()
  lastActivityAt: Date;

  @Field()
  name: string;

  @Field()
  email: string;

  @Field({ description: 'Aberto por alguém da equipe logado' })
  fromStaff: boolean;

  @Field(() => Int, { nullable: true, description: 'Conta de cliente de quem pediu, se logado' })
  clientAccountId: number | null;

  @Field()
  clientSuspended: boolean;
}

@ObjectType()
export class AdminClientAccountType {
  @Field(() => Int)
  id: number;

  @Field()
  email: string;

  @Field()
  name: string;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  emailVerifiedAt: Date | null;

  @Field()
  linkedToStaff: boolean;

  @Field(() => Int, { description: 'Fichas de cliente ligadas (unidades onde já foi atendido)' })
  customerRecords: number;

  @Field(() => Date, { nullable: true })
  suspendedAt: Date | null;

  @Field(() => String, { nullable: true })
  suspendedReason: string | null;
}

/**
 * Suporte humano ("Fale com a gente" e a fila do backoffice) e a suspensão
 * de contas de cliente pelo admin da plataforma.
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class SupportResolver {
  constructor(
    private readonly support: SupportService,
    private readonly clientAuth: ClientAuthService,
    private readonly suspension: ClientSuspensionService,
  ) {}

  /** Visitante ou cliente (logado, o pedido fica ligado à conta) */
  @ThrottleEmail()
  @Mutation(() => SupportTicketCreatedType)
  async contactSupport(@Args('input') input: ContactSupportInput, @Context() context: any) {
    const clientAccountId = await this.clientAuth.optionalClientAccountId(context.req);
    return this.support.create(input, { clientAccountId });
  }

  /** Alguém da equipe, logado: o pedido fica ligado à conta da equipe */
  @ThrottleEmail()
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => SupportTicketCreatedType)
  staffContactSupport(@Args('input') input: ContactSupportInput, @CurrentUser() user: UserDTO) {
    return this.support.create(input, { userId: user.id });
  }

  /** Quem pediu, pelo link do e-mail (sem login) */
  @Query(() => SupportTicketPublicType)
  supportTicket(@Args('token') token: string) {
    return this.support.forRequester(token);
  }

  @ThrottleSupportReply()
  @Mutation(() => Boolean)
  replySupportTicket(@Args('token') token: string, @Args('body') body: string) {
    return this.support.requesterReply(token, body);
  }

  // ---- equipe da plataforma ----

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Query(() => [SupportTicketType])
  supportQueue(@Args('status', { nullable: true }) status?: string) {
    return this.support.queue(status);
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Query(() => Int)
  supportOpenCount() {
    return this.support.openCount();
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Mutation(() => Boolean)
  answerSupportTicket(
    @Args('ticketId', { type: () => Int }) ticketId: number,
    @Args('body') body: string,
    @CurrentUser() user: UserDTO,
    @Args('close', { nullable: true }) close?: boolean,
  ) {
    return this.support.answer(user.id, ticketId, body, !!close);
  }

  /** open | answered | closed */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Mutation(() => Boolean)
  setSupportTicketStatus(
    @Args('ticketId', { type: () => Int }) ticketId: number,
    @Args('status') status: string,
  ) {
    return this.support.setStatus(ticketId, status);
  }

  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Query(() => [AdminClientAccountType])
  adminClientAccounts(@Args('search', { nullable: true }) search?: string) {
    return this.suspension.search(search);
  }

  /** Suspender (fraude, abuso) ou reativar a conta de um cliente */
  @UseGuards(GraphQLJwtAuthGuard, RolesGuard)
  @Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
  @RequireArea(BackofficeArea.SUPPORT)
  @Mutation(() => Boolean)
  setClientAccountSuspended(
    @Args('clientAccountId', { type: () => Int }) clientAccountId: number,
    @Args('suspended') suspended: boolean,
    @CurrentUser() user: UserDTO,
    @Args('reason', { nullable: true }) reason?: string,
  ) {
    return this.suspension.setSuspended(user.id, clientAccountId, suspended, reason);
  }
}
