import { Resolver, Query, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ClientAuthService } from '@/client-auth/client-auth.service';
import { GraphQLClientJwtAuthGuard } from '@/client-auth/guards/graphql-client-jwt-auth.guard';
import { CurrentClient, CurrentClientUser } from '@/client-auth/current-client.decorator';
import { ClientAccountType, ClientHistoryEntryType } from '../types/client-auth.type';
import { Network } from '../types/barbershop.type';
import { ClientSignupInput, ClientLoginInput } from '../dto/client-auth.dto';

@Resolver()
export class ClientAuthResolver {
  constructor(private readonly clientAuthService: ClientAuthService) {}

  @Mutation(() => ClientAccountType)
  async clientSignup(
    @Args('input') input: ClientSignupInput,
    @Context() context: any,
  ): Promise<ClientAccountType> {
    const { res } = context;
    const account = await this.clientAuthService.signup(input.email, input.password, input.name, input.phone);
    this.clientAuthService.issueCookie(account, res);
    return { id: account.id, email: account.email, name: account.name, phone: account.phone ?? undefined, avatarUrl: account.avatarUrl ?? undefined };
  }

  @Mutation(() => ClientAccountType)
  async clientLogin(
    @Args('input') input: ClientLoginInput,
    @Context() context: any,
  ): Promise<ClientAccountType> {
    const { res } = context;
    const account = await this.clientAuthService.validateCredentials(input.email, input.password);
    this.clientAuthService.issueCookie(account, res);
    return { id: account.id, email: account.email, name: account.name, phone: account.phone ?? undefined, avatarUrl: account.avatarUrl ?? undefined };
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
  async addClientFavorite(@CurrentClient() client: CurrentClientUser, @Args('networkId') networkId: number) {
    return this.clientAuthService.addFavorite(client.id, networkId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Mutation(() => [Network])
  async removeClientFavorite(@CurrentClient() client: CurrentClientUser, @Args('networkId') networkId: number) {
    return this.clientAuthService.removeFavorite(client.id, networkId);
  }

  @UseGuards(GraphQLClientJwtAuthGuard)
  @Query(() => [Network])
  async searchNetworks(@Args('query') query: string) {
    return this.clientAuthService.searchNetworks(query);
  }
}
