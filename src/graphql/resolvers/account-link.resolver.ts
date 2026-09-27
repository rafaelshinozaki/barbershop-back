import { Args, Context, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { AuthService } from '../../auth/auth.service';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleLogin } from '../../common/decorators/throttle.decorator';
import { AccountLinkService } from '../../client-auth/account-link.service';
import { ClientAuthService } from '../../client-auth/client-auth.service';
import { GraphQLClientJwtAuthGuard } from '../../client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '../../client-auth/current-client.decorator';

/** Ligação entre a conta de cliente e a da equipe, vista da área do cliente */
@ObjectType()
export class ClientAccountLinkType {
  @Field()
  linked: boolean;

  @Field({ description: 'Há uma conta da equipe com o mesmo e-mail pra ligar' })
  canLink: boolean;

  @Field({ description: 'Dá pra abrir a área da equipe sem digitar a senha (sem 2FA)' })
  canOpenOtherArea: boolean;
}

/** Ligação vista pela equipe */
@ObjectType()
export class StaffClientLinkType {
  @Field()
  linked: boolean;

  @Field({ description: 'Há uma conta de cliente com o mesmo e-mail pra ligar' })
  canLink: boolean;

  @Field({ description: 'A conta de cliente tem senha (sem ela, liga pela área do cliente)' })
  clientHasPassword: boolean;
}

/**
 * Uma pessoa, duas telas: a conta de cliente e a da equipe ligadas pelo
 * e-mail, com a senha da equipe valendo nas duas. Daqui se liga uma à outra
 * e se passa de uma área pra outra sem entrar de novo.
 */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class AccountLinkResolver {
  constructor(
    private readonly accountLink: AccountLinkService,
    private readonly clientAuth: ClientAuthService,
    private readonly auth: AuthService,
  ) {}

  // ---- área do cliente ----

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => ClientAccountLinkType)
  clientAccountLink(@CurrentClient() client: CurrentClientUser) {
    return this.accountLink.statusForClient(client.id);
  }

  @ThrottleLogin()
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async clientLinkStaffAccount(
    @CurrentClient() client: CurrentClientUser,
    @Args('password') password: string,
    @Context() context: any,
  ) {
    const account = await this.accountLink.linkFromClient(client.id, password);
    // A ligação derruba as sessões antigas da área do cliente; esta continua
    this.clientAuth.issueCookie(account, context.res);
    return true;
  }

  /** Abre a área da equipe (sessão nova da equipe), sem pedir a senha de novo */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async clientOpenStaffArea(@CurrentClient() client: CurrentClientUser, @Context() context: any) {
    const staff = await this.accountLink.staffForClient(client.id);
    await this.auth.login(staff as unknown as UserDTO, context.req, context.res);
    return true;
  }

  // ---- área da equipe ----

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => StaffClientLinkType)
  myClientAccountLink(@CurrentUser() user: UserDTO) {
    return this.accountLink.statusForStaff(user.id);
  }

  @ThrottleLogin()
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async linkMyClientAccount(@CurrentUser() user: UserDTO, @Args('password') password: string) {
    await this.accountLink.linkFromStaff(user.id, password);
    return true;
  }

  /**
   * Abre a área do cliente: ligada, entra; sem conta de cliente, cria uma já
   * ligada. Devolve true quando criou (o front avisa pra confirmar o e-mail).
   */
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async openClientArea(@CurrentUser() user: UserDTO, @Context() context: any) {
    const { account, created } = await this.accountLink.clientAccountForStaff(user.id);
    if (created) await this.clientAuth.sendVerificationEmail(account);
    this.clientAuth.issueCookie(account, context.res);
    return created;
  }
}
