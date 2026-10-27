import { PresignedUploadType } from '../types/upload.type';
import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { BadRequestException, Logger, NotFoundException, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Network } from '../types/barbershop.type';
import { BarbershopService } from '../../barbershop/barbershop.service';
import { S3Service } from '../../aws/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';

@Resolver(() => Network)
export class NetworkResolver {
  private readonly logger = new Logger(NetworkResolver.name);

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
    // Só o link, com nome novo a cada envio: a logo troca em setNetworkLogo,
    // depois do envio. Antes a chave era gravada aqui (envio que falhava
    // quebrava a logo da rede inteira) e o caminho era fixo (PNG e JPG
    // ficavam os dois no S3) (item 340)
    return this.s3Service.createImageUpload(
      `networks/${network.id}/logo-${randomUUID()}`,
      contentType,
    );
  }

  /** Confirma a logo enviada; devolve o link dela (a anterior sai do S3) */
  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => String, { nullable: true })
  async setNetworkLogo(@CurrentUser() user: UserDTO, @Args('key') key: string) {
    return this.replaceLogo(user.id, key);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @Mutation(() => Boolean)
  async removeNetworkLogo(@CurrentUser() user: UserDTO): Promise<boolean> {
    await this.replaceLogo(user.id, null);
    return true;
  }

  private async replaceLogo(userId: number, key: string | null) {
    const network = await this.barbershopService.getMyNetwork(userId);
    if (!network) throw new NotFoundException('Franquia não encontrada');
    const prefix = `networks/${network.id}/`;
    if (key && (!key.startsWith(prefix) || key.includes('..'))) {
      throw new BadRequestException('Arquivo inválido');
    }
    await this.prisma.network.update({
      where: { id: network.id },
      data: { logoKey: key, logoUrl: null },
    });
    if (network.logoKey && network.logoKey !== key) {
      const old = network.logoKey;
      this.s3Service
        .deleteObject(old)
        .catch((err) => this.logger.warn(`Não apagou ${old} do S3: ${String(err)}`));
    }
    return key ? this.s3Service.getDownloadUrl(key) : null;
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
