import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { BarbershopService } from '../../barbershop/barbershop.service';
import { UseGuards } from '@nestjs/common';
import { Barbershop } from '../types/barbershop.type';
import { S3Service } from '../../aws/s3.service';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';

@Resolver(() => Barbershop)
export class BarbershopPhotoResolver {
  constructor(
    private readonly s3Service: S3Service,
    private readonly barbershopService: BarbershopService,
  ) {}

  /**
   * Cargo de quem está logado nesta unidade: 'owner' | 'manager' | 'barber'
   * (null sem acesso). O front usa pra mostrar só o que o cargo pode fazer.
   */
  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField('myAccessLevel', () => String, { nullable: true })
  async myAccessLevel(
    @Parent() barbershop: { id: number },
    @CurrentUser() user: UserDTO,
  ): Promise<string | null> {
    if (!user?.id) return null;
    return this.barbershopService.getMyAccessLevel(user.id, barbershop.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @ResolveField('imageUrl', () => String, { nullable: true })
  async imageUrl(@Parent() barbershop: { photoKey?: string | null }): Promise<string | null> {
    if (barbershop.photoKey) {
      return this.s3Service.getDownloadUrl(barbershop.photoKey);
    }
    return null;
  }
}
