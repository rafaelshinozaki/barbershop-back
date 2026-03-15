import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Network } from '../types/barbershop.type';
import { BarbershopService } from '../../barbershop/barbershop.service';
import { S3Service } from '../../aws/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';

@Resolver(() => Network)
export class NetworkResolver {
  constructor(
    private readonly barbershopService: BarbershopService,
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField('logoUrl', () => String, { nullable: true })
  async logoUrl(
    @Parent() network: { id: number; logoKey?: string | null; logoUrl?: string | null },
  ): Promise<string | null> {
    if (network.logoKey) {
      return this.s3Service.getDownloadUrl(network.logoKey);
    }
    return network.logoUrl ?? null;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => String)
  async getNetworkLogoUploadUrl(
    @CurrentUser() user: UserDTO,
    @Args('fileExtension', { nullable: true }) fileExtension?: string,
    @Args('contentType', { nullable: true }) contentType?: string,
  ): Promise<string> {
    const network = await this.barbershopService.getMyNetwork(user.id);
    if (!network) {
      throw new Error('Franquia não encontrada');
    }
    const ext = fileExtension || 'jpg';
    const logoKey = `networks/${network.id}/logo.${ext}`;
    const uploadUrl = await this.s3Service.getUploadUrl(logoKey, contentType);

    await this.prisma.network.update({
      where: { id: network.id },
      data: { logoKey, logoUrl: null },
    });

    return uploadUrl;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => String, { nullable: true })
  async getNetworkLogoUrl(@CurrentUser() user: UserDTO): Promise<string | null> {
    const network = await this.barbershopService.getMyNetwork(user.id);
    if (!network?.logoKey) return null;
    return this.s3Service.getDownloadUrl(network.logoKey);
  }
}
