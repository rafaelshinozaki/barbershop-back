import { Resolver, ResolveField, Args, Int, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BarbershopProductType } from '../types/barbershop.type';
import { S3Service } from '../../aws/s3.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';

@Resolver(() => BarbershopProductType)
export class BarbershopProductResolver {
  constructor(private readonly s3Service: S3Service) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField('imageUrl', () => String, { nullable: true })
  async imageUrl(
    @Parent() product: { imageKey?: string | null },
  ): Promise<string | null> {
    if (product.imageKey) {
      return this.s3Service.getDownloadUrl(product.imageKey);
    }
    return null;
  }
}
