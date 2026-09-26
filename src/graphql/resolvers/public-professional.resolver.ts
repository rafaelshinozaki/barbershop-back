import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseFilters } from '@nestjs/common';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { CareerService } from '../../barbershop/career.service';
import { PublicProfessionalType } from '../types/career.type';

/** /p/:slug. Sem login. Perfil oculto responde como se não existisse. */
@Resolver()
@UseFilters(GqlHttpExceptionFilter)
export class PublicProfessionalResolver {
  constructor(private readonly career: CareerService) {}

  @Query(() => PublicProfessionalType)
  publicProfessional(@Args('slug') slug: string) {
    return this.career.publicProfile(slug);
  }
}
