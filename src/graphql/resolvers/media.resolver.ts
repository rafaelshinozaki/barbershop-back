import {
  Args,
  Field,
  Int,
  Mutation,
  ObjectType,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { BarbershopMediaService } from '../../barbershop/media.service';
import { S3Service } from '../../aws/s3.service';
import { PresignedUploadType } from '../types/upload.type';
import { Barber } from '../types/barbershop.type';
import { PublicBarberType } from '../types/public-booking.type';

@ObjectType()
export class BarbershopPhotoType {
  @Field(() => Int)
  id: number;

  @Field()
  url: string;

  @Field({ nullable: true })
  caption?: string;

  @Field(() => Int)
  position: number;
}

/**
 * Fotos da página pública: galeria, capa e foto dos profissionais. Envio em
 * dois passos: pede o formulário (…Upload), o navegador manda pro S3 e
 * confirma a chave (add…/set…).
 */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class MediaResolver {
  constructor(private readonly media: BarbershopMediaService) {}

  @Query(() => [BarbershopPhotoType])
  barbershopPhotos(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.media.listPhotos(user.id, barbershopId);
  }

  @Mutation(() => PresignedUploadType)
  barbershopGalleryUpload(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('contentType', { nullable: true }) contentType?: string,
  ) {
    return this.media.galleryUpload(user.id, barbershopId, contentType);
  }

  @Mutation(() => BarbershopPhotoType)
  addBarbershopPhoto(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('key') key: string,
    @CurrentUser() user: UserDTO,
    @Args('caption', { nullable: true }) caption?: string,
  ) {
    return this.media.addPhoto(user.id, barbershopId, key, caption);
  }

  @Mutation(() => Boolean)
  removeBarbershopGalleryPhoto(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: UserDTO,
  ) {
    return this.media.removePhoto(user.id, barbershopId, id);
  }

  @Mutation(() => [BarbershopPhotoType])
  reorderBarbershopPhotos(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('ids', { type: () => [Int] }) ids: number[],
    @CurrentUser() user: UserDTO,
  ) {
    return this.media.reorderPhotos(user.id, barbershopId, ids);
  }

  @Mutation(() => PresignedUploadType)
  barbershopCoverUpload(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('contentType', { nullable: true }) contentType?: string,
  ) {
    return this.media.coverUpload(user.id, barbershopId, contentType);
  }

  /** Confirma a capa (key) ou tira (sem key); devolve o link da capa */
  @Mutation(() => String, { nullable: true })
  setBarbershopCover(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @CurrentUser() user: UserDTO,
    @Args('key', { nullable: true }) key?: string,
  ) {
    return this.media.setCover(user.id, barbershopId, key ?? null);
  }

  @Mutation(() => PresignedUploadType)
  barberAvatarUpload(
    @Args('barberId', { type: () => Int }) barberId: number,
    @CurrentUser() user: UserDTO,
    @Args('contentType', { nullable: true }) contentType?: string,
  ) {
    return this.media.avatarUpload(user.id, barberId, contentType);
  }

  /** Confirma a foto do profissional (key) ou tira (sem key) */
  @Mutation(() => String, { nullable: true })
  setBarberAvatar(
    @Args('barberId', { type: () => Int }) barberId: number,
    @CurrentUser() user: UserDTO,
    @Args('key', { nullable: true }) key?: string,
  ) {
    return this.media.setAvatar(user.id, barberId, key ?? null);
  }
}

type WithAvatar = { avatarUrl?: string | null; avatarKey?: string | null };

/** Foto enviada vale por cima do link digitado (links do S3 expiram: gera na hora) */
async function avatarOf(s3: S3Service, b: WithAvatar) {
  return b.avatarKey ? s3.getDownloadUrl(b.avatarKey) : b.avatarUrl ?? null;
}

@Resolver(() => Barber)
export class BarberAvatarResolver {
  constructor(private readonly s3: S3Service) {}

  @ResolveField(() => String, { nullable: true })
  avatarUrl(@Parent() barber: WithAvatar) {
    return avatarOf(this.s3, barber);
  }
}

@Resolver(() => PublicBarberType)
export class PublicBarberAvatarResolver {
  constructor(private readonly s3: S3Service) {}

  @ResolveField(() => String, { nullable: true })
  avatarUrl(@Parent() barber: WithAvatar) {
    return avatarOf(this.s3, barber);
  }
}
