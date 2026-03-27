import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Barbershop } from '../types/barbershop.type';
import { S3Service } from '../../aws/s3.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';

@Resolver(() => Barbershop)
export class BarbershopPhotoResolver {
  constructor(private readonly s3Service: S3Service) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField('imageUrl', () => String, { nullable: true })
  async imageUrl(
    @Parent() barbershop: { photoKey?: string | null },
  ): Promise<string | null> {
    if (barbershop.photoKey) {
      return this.s3Service.getDownloadUrl(barbershop.photoKey);
    }
    return null;
  }
}
