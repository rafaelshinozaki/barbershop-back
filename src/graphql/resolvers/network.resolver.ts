import { PresignedUploadType } from '../types/upload.type';
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
  @Mutation(() => PresignedUploadType)
  async getNetworkLogoUploadUrl(
    @CurrentUser() user: UserDTO,
    @Args('contentType', { nullable: true }) contentType?: string,
  ): Promise<PresignedUploadType> {
    const network = await this.barbershopService.getMyNetwork(user.id);
    if (!network) {
      throw new Error('Franquia não encontrada');
    }
    const upload = await this.s3Service.createImageUpload(
      `networks/${network.id}/logo`,
      contentType,
    );
    const logoKey = upload.key;

    await this.prisma.network.update({
      where: { id: network.id },
      data: { logoKey, logoUrl: null } as { logoKey: string; logoUrl: null },
    });

    return upload;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async removeNetworkLogo(@CurrentUser() user: UserDTO): Promise<boolean> {
    const network = await this.barbershopService.getMyNetwork(user.id);
    if (!network) throw new Error('Franquia não encontrada');
    await this.prisma.network.update({
      where: { id: network.id },
      data: { logoKey: null, logoUrl: null },
    });
    return true;
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => String, { nullable: true })
  async getNetworkLogoUrl(@CurrentUser() user: UserDTO): Promise<string | null> {
    const network = await this.barbershopService.getMyNetwork(user.id);
    const logoKey =
      network && 'logoKey' in network ? (network as { logoKey?: string }).logoKey : null;
    if (!logoKey) return null;
    return this.s3Service.getDownloadUrl(logoKey);
  }
}
