import { Controller, UseGuards } from '@nestjs/common';
import { BackofficeService } from './backoffice.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/interfaces/roles';

@Controller('backoffice')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN, Role.SYSTEM_MANAGER)
export class BackofficeController {
  constructor(private readonly backofficeService: BackofficeService) {}

  // All REST endpoints have been migrated to GraphQL
  // See src/graphql/resolvers/backoffice.resolver.ts for the new GraphQL queries
}
