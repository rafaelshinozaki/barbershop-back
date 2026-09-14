import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { SocialService } from '@/social/social.service';
import { SocialConnectionType, SocialPostType, SocialPostImageUploadUrlType } from '../types/social.type';
import { CreateSocialPostInput } from '../dto/social.dto';

@Resolver()
export class SocialResolver {
  constructor(private readonly socialService: SocialService) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => SocialConnectionType, { nullable: true })
  async socialConnection(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.socialService.getConnection(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async disconnectSocialAccount(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.socialService.disconnect(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => SocialPostImageUploadUrlType)
  async getSocialPostImageUploadUrl(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('fileExtension') fileExtension: string,
    @Args('contentType', { nullable: true }) contentType: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.socialService.getPostImageUploadUrl(user.id, barbershopId, fileExtension, contentType);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => SocialPostType)
  async createSocialPost(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('input') input: CreateSocialPostInput,
    @CurrentUser() user: UserDTO,
  ) {
    const post = await this.socialService.createPost(user.id, barbershopId, input);
    return {
      ...post,
      scheduledFor: post.scheduledFor.toISOString(),
      publishedAt: post.publishedAt?.toISOString(),
      createdAt: post.createdAt.toISOString(),
      imageUrl: '',
    };
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => [SocialPostType])
  async socialPosts(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.socialService.getPosts(user.id, barbershopId);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async deleteSocialPost(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.socialService.deletePost(user.id, barbershopId, id);
  }
}
