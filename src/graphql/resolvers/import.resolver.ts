import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseFilters, UseGuards } from '@nestjs/common';
import { GraphQLJwtAuthGuard } from '../../auth/guards/graphql-jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UserDTO } from '../../auth/users/dto/user.dto';
import { GqlHttpExceptionFilter } from '../filters/gql-http-exception.filter';
import { ImportService } from '../../barbershop/import.service';
import { ShopImportResultType } from '../types/import.type';

/** Planilha de clientes, serviços e agenda (Booksy, Trinks ou CSV). */
@Resolver()
@UseGuards(GraphQLJwtAuthGuard)
@UseFilters(GqlHttpExceptionFilter)
export class ImportResolver {
  constructor(private readonly imports: ImportService) {}

  @Query(() => ShopImportResultType)
  previewShopImport(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('csv') csv: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.imports.preview(user.id, barbershopId, csv);
  }

  @Mutation(() => ShopImportResultType)
  importShopData(
    @Args('barbershopId', { type: () => Int }) barbershopId: number,
    @Args('csv') csv: string,
    @CurrentUser() user: UserDTO,
  ) {
    return this.imports.apply(user.id, barbershopId, csv);
  }
}
