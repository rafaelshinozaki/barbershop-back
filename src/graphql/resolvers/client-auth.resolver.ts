import { Resolver, Query, Mutation, Args, Context, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ClientAuthService } from '@/client-auth/client-auth.service';
import { GraphQLClientJwtAuthGuard } from '@/client-auth/guards/graphql-client-jwt-auth.guard';
import { OptionalClientJwtAuthGuard } from '@/client-auth/guards/optional-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '@/client-auth/current-client.decorator';
import {
  ClientAccountType,
  ClientFavoriteBarberType,
  ClientHistoryEntryType,
  ClientLinkedSocialAccountType,
  ClientMarketingPreferencesType,
} from '../types/client-auth.type';
import { Network } from '../types/barbershop.type';
import {
  ClientSignupInput,
  ClientLoginInput,
  ClientForgotPasswordInput,
  ClientResetPasswordInput,
  ClientDeleteAccountInput,
  ClientUpdateProfileInput,
} from '../dto/client-auth.dto';
import {
  ThrottleAuth,
  ThrottleEmail,
  ThrottleLogin,
  ThrottlePasswordReset,
} from '../../common/decorators/throttle.decorator';

function toClientAccountType(account: {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  password: string | null;
  userId?: number | null;
}): ClientAccountType {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone ?? undefined,
    avatarUrl: account.avatarUrl ?? undefined,
    emailVerified: !!account.emailVerifiedAt,
    hasPassword: !!account.password || !!account.userId,
    linkedToStaff: !!account.userId,
  };
}

@Resolver()
export class ClientAuthResolver {
  constructor(private readonly clientAuthService: ClientAuthService) {}

  // Mesmo limite do cadastro de dono (por IP + navegador)
  @ThrottleAuth()
  @Mutation(() => ClientAccountType)
  async clientSignup(
    @Args('input') input: ClientSignupInput,
    @Context() context: any,
  ): Promise<ClientAccountType> {
    const account = await this.clientAuthService.signup(
      input.email,
      input.password,
      input.name,
      input.phone,
      input.language,
      input.emailCode,
    );
    await this.clientAuthService.issueCookie(account, context.res);
    return toClientAccountType(account);
  }

  // Antes não tinha limite nenhum: dava pra chutar senha à vontade
  @ThrottleLogin()
  @Mutation(() => ClientAccountType)
  async clientLogin(
    @Args('input') input: ClientLoginInput,
    @Context() context: any,
  ): Promise<ClientAccountType> {
    const account = await this.clientAuthService.validateCredentials(input.email, input.password);
    await this.clientAuthService.issueCookie(account, context.res);
    return toClientAccountType(account);
  }

  /** Confirma o e-mail pelo link; o histórico das barbearias passa a aparecer. */
  @ThrottleAuth()
  @Mutation(() => Boolean)
  async clientVerifyEmail(@Args('token') token: string): Promise<boolean> {
    await this.clientAuthService.verifyEmail(token);
    return true;
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @ThrottleEmail()
  @Mutation(() => Boolean)
  async clientResendVerificationEmail(@CurrentClient() client: CurrentClientUser) {
    await this.clientAuthService.resendVerificationEmail(client.id);
    return true;
  }

  /**
   * Exclusão pelo link do e-mail de suspensão (LGPD). A conta suspensa não
   * entra; o token do e-mail é a confirmação. Abrir o link não apaga.
   */
  @ThrottleAuth()
  @Mutation(() => Boolean)
  async clientDeleteAccountByLink(@Args('token') token: string) {
    await this.clientAuthService.deleteAccountByToken(token);
    return true;
  }

  /** Exclusão da conta pelo titular (LGPD); encerra a sessão. */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @ThrottleAuth()
  @Mutation(() => Boolean)
  async clientDeleteAccount(
    @CurrentClient() client: CurrentClientUser,
    @Args('input') input: ClientDeleteAccountInput,
    @Context() context: any,
  ) {
    await this.clientAuthService.deleteAccount(client.id, input);
    this.clientAuthService.clearCookie(context.res);
    return true;
  }

  /** Sempre true (não revela se o e-mail tem conta). */
  @ThrottlePasswordReset()
  @Mutation(() => Boolean)
  async clientForgotPassword(@Args('input') input: ClientForgotPasswordInput) {
    await this.clientAuthService.requestPasswordReset(input.email);
    return true;
  }

  /** Nova senha pelo link do e-mail; as sessões abertas caem. */
  @ThrottleAuth()
  @Mutation(() => Boolean)
  async clientResetPassword(@Args('input') input: ClientResetPasswordInput) {
    await this.clientAuthService.resetPassword(input.token, input.password);
    return true;
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async clientLogout(@Context() context: any): Promise<boolean> {
    const { req, res } = context;
    await this.clientAuthService.endSession(req, res);
    return true;
  }

  /** Há cliente logado? Sem sessão devolve null (o `clientMe` dá erro) */
  @UseGuards(OptionalClientJwtAuthGuard)
  @Query(() => ClientAccountType, { nullable: true })
  async clientSession(
    @CurrentClient() client?: CurrentClientUser,
  ): Promise<ClientAccountType | null> {
    if (!client?.id) return null;
    return this.clientAuthService.getById(client.id).catch(() => null);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => ClientAccountType)
  async clientMe(@CurrentClient() client: CurrentClientUser): Promise<ClientAccountType> {
    return this.clientAuthService.getById(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => ClientAccountType)
  async updateClientProfile(
    @CurrentClient() client: CurrentClientUser,
    @Args('input') input: ClientUpdateProfileInput,
  ): Promise<ClientAccountType> {
    return this.clientAuthService.updateProfile(client.id, input.name, input.phone);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ClientHistoryEntryType])
  async clientHistory(@CurrentClient() client: CurrentClientUser) {
    return this.clientAuthService.getHistory(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ClientFavoriteBarberType])
  async clientFavoriteBarbers(@CurrentClient() client: CurrentClientUser) {
    return this.clientAuthService.listFavoriteBarbers(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => [ClientFavoriteBarberType])
  async addClientFavoriteBarber(
    @CurrentClient() client: CurrentClientUser,
    @Args('barberId', { type: () => Int }) barberId: number,
  ) {
    return this.clientAuthService.addFavoriteBarber(client.id, barberId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => [ClientFavoriteBarberType])
  async removeClientFavoriteBarber(
    @CurrentClient() client: CurrentClientUser,
    @Args('barberId', { type: () => Int }) barberId: number,
  ) {
    return this.clientAuthService.removeFavoriteBarber(client.id, barberId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [Network])
  async clientFavorites(@CurrentClient() client: CurrentClientUser) {
    return this.clientAuthService.listFavorites(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => [Network])
  async addClientFavorite(
    @CurrentClient() client: CurrentClientUser,
    @Args('networkId') networkId: number,
  ) {
    return this.clientAuthService.addFavorite(client.id, networkId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => [Network])
  async removeClientFavorite(
    @CurrentClient() client: CurrentClientUser,
    @Args('networkId') networkId: number,
  ) {
    return this.clientAuthService.removeFavorite(client.id, networkId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [Network])
  async searchNetworks(@Args('query') query: string) {
    return this.clientAuthService.searchNetworks(query);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ClientLinkedSocialAccountType])
  async clientLinkedSocialAccounts(@CurrentClient() client: CurrentClientUser) {
    const accounts = await this.clientAuthService.getLinkedSocialAccounts(client.id);
    return accounts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => Boolean)
  async unlinkClientSocialAccount(
    @CurrentClient() client: CurrentClientUser,
    @Args('provider') provider: string,
  ) {
    await this.clientAuthService.unlinkSocialAccount(client.id, provider);
    return true;
  }

  /** Campanhas: o que a pessoa quer receber (e-mail por barbearia; WhatsApp) */
  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => ClientMarketingPreferencesType)
  async clientMarketingPreferences(@CurrentClient() client: CurrentClientUser) {
    return this.clientAuthService.marketingPreferences(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => ClientMarketingPreferencesType, {
    description: 'Sai (ou volta) das campanhas por e-mail de uma barbearia',
  })
  async setClientEmailMarketing(
    @CurrentClient() client: CurrentClientUser,
    @Args('networkId', { type: () => Int }) networkId: number,
    @Args('optOut') optOut: boolean,
  ) {
    return this.clientAuthService.setNetworkEmailOptOut(client.id, networkId, optOut);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => ClientMarketingPreferencesType, {
    description: 'Sai (ou volta) das campanhas pelo WhatsApp',
  })
  async setClientWhatsappMarketing(
    @CurrentClient() client: CurrentClientUser,
    @Args('optOut') optOut: boolean,
  ) {
    return this.clientAuthService.setWhatsappOptOut(client.id, optOut);
  }
}
