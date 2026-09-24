import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ClientAuthService } from '@/client-auth/client-auth.service';
import { GraphQLClientJwtAuthGuard } from '@/client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '@/client-auth/current-client.decorator';
import {
  ClientAccountType,
  ClientHistoryEntryType,
  ClientLinkedSocialAccountType,
} from '../types/client-auth.type';
import { Network } from '../types/barbershop.type';
import {
  ClientSignupInput,
  ClientLoginInput,
  ClientForgotPasswordInput,
  ClientResetPasswordInput,
  ClientDeleteAccountInput,
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
}): ClientAccountType {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone ?? undefined,
    avatarUrl: account.avatarUrl ?? undefined,
    emailVerified: !!account.emailVerifiedAt,
    hasPassword: !!account.password,
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
    );
    this.clientAuthService.issueCookie(account, context.res);
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
    this.clientAuthService.issueCookie(account, context.res);
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
    const { res } = context;
    this.clientAuthService.clearCookie(res);
    return true;
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => ClientAccountType)
  async clientMe(@CurrentClient() client: CurrentClientUser): Promise<ClientAccountType> {
    return this.clientAuthService.getById(client.id);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [ClientHistoryEntryType])
  async clientHistory(@CurrentClient() client: CurrentClientUser) {
    return this.clientAuthService.getHistory(client.id);
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
}
