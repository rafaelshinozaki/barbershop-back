import { Args, Field, Mutation, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ThrottleAuth } from '../../common/decorators/throttle.decorator';
import { IdentityVerificationService } from '../../barbershop/identity-verification.service';

@ObjectType()
export class IdentityVerificationStatusType {
  @Field({ description: 'Ligou "Atendo a domicílio" (só quem atende a domicílio verifica)' })
  offersHomeService: boolean;

  @Field()
  verified: boolean;

  @Field(() => Date, { nullable: true })
  verifiedAt: Date | null;

  @Field(() => String, {
    nullable: true,
    description:
      'Última tentativa: pending | processing | verified | requires_input | canceled | name_mismatch',
  })
  status: string | null;

  @Field(() => String, { nullable: true, description: 'Motivo do Stripe ao pedir de novo' })
  lastErrorCode: string | null;
}

@ObjectType()
export class IdentityVerificationStartType {
  @Field({ description: 'Página de verificação (Stripe Identity)' })
  url: string;
}

/** Verificação de identidade de quem atende a domicílio (Stripe Identity) */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class IdentityVerificationResolver {
  constructor(private readonly identity: IdentityVerificationService) {}

  @Query(() => IdentityVerificationStatusType)
  myIdentityVerification(@CurrentUser() user: UserDTO) {
    return this.identity.status(user.id);
  }

  @ThrottleAuth()
  @Mutation(() => IdentityVerificationStartType)
  startIdentityVerification(@CurrentUser() user: UserDTO) {
    return this.identity.start(user.id);
  }

  /** Só fora de produção, com o fornecedor falso (desenvolvimento e E2E) */
  @Mutation(() => Boolean)
  completeFakeIdentityVerification(
    @CurrentUser() user: UserDTO,
    @Args('sessionId') sessionId: string,
    @Args('outcome', { description: 'verified | requires_input | other_person' }) outcome: string,
  ) {
    return this.identity.completeFake(user.id, sessionId, outcome);
  }
}
