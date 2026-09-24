import {
  Args,
  Context,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString } from 'class-validator';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { AccountDeletionService } from '../../barbershop/account-deletion.service';
import { ThrottleAuth } from '../../common/decorators/throttle.decorator';

@ObjectType()
export class AccountDeletionPreviewType {
  /** Unidades apagadas junto (a pessoa é dona) */
  @Field(() => [String])
  barbershops: string[];

  /** Assinaturas de serviço de clientes que serão canceladas */
  @Field(() => Int)
  activeClientSubscriptions: number;

  /** true = confirma com a senha; false (login social) = digitando o e-mail */
  @Field()
  requiresPassword: boolean;

  /** Admin do sistema não se exclui por aqui */
  @Field()
  blocked: boolean;
}

@InputType()
export class DeleteMyAccountInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  password?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  email?: string;
}

/** Exclusão da própria conta (LGPD) — dono, gerente ou barbeiro. */
@Resolver()
export class AccountDeletionResolver {
  constructor(
    private readonly accountDeletion: AccountDeletionService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(GraphQLJwtAuthGuard)
  @Query(() => AccountDeletionPreviewType)
  async accountDeletionPreview(@CurrentUser() user: UserDTO) {
    return this.accountDeletion.preview(user.id);
  }

  @UseGuards(GraphQLJwtAuthGuard)
  @ThrottleAuth()
  @Mutation(() => Boolean)
  async deleteMyAccount(
    @CurrentUser() user: UserDTO,
    @Args('input') input: DeleteMyAccountInput,
    @Context() context: any,
  ) {
    await this.accountDeletion.deleteAccount(user.id, input);
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    context.res.clearCookie('Authentication', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });
    return true;
  }
}
